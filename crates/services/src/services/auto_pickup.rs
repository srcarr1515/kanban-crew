use async_trait::async_trait;
use db::{
    DBService,
    models::{project::Project, task::Task},
};
use uuid::Uuid;

/// Context passed to the task assignment strategy for decision-making.
pub struct TaskAssignmentContext {
    /// The task that was just completed (moved to in_review).
    pub completed_task: Task,
    /// All tasks currently in "done" status (for understanding what's been built).
    pub done_tasks: Vec<Task>,
    /// All tasks currently in "in_progress" (for understanding parallel work).
    pub in_progress_tasks: Vec<Task>,
}

/// Result of the auto-pickup flow.
#[derive(Debug)]
pub struct AutoPickupResult {
    pub selected_task_id: Uuid,
    pub selected_task_title: String,
    /// If the selected task is a sub-issue, this is its parent task ID.
    pub parent_task_id: Option<Uuid>,
}

/// Trait for selecting the next task to work on.
/// This is the seam where a future "Manager" persona can plug in.
#[async_trait]
pub trait TaskAssignmentStrategy: Send + Sync {
    async fn select_next_task(
        &self,
        ready_tasks: &[Task],
        context: &TaskAssignmentContext,
    ) -> Result<Uuid, AutoPickupError>;
}

/// Simple strategy: pick the first ready task by sort order.
/// Used when there's only one ready task, or as a fallback.
pub struct SimpleTaskAssignment;

#[async_trait]
impl TaskAssignmentStrategy for SimpleTaskAssignment {
    async fn select_next_task(
        &self,
        ready_tasks: &[Task],
        _context: &TaskAssignmentContext,
    ) -> Result<Uuid, AutoPickupError> {
        ready_tasks
            .first()
            .map(|t| t.id)
            .ok_or(AutoPickupError::NoReadyTasks)
    }
}

/// LLM-ranked strategy: uses Anthropic API to pick the best next task
/// based on what's been done, what's in progress, and what's ready.
pub struct LlmRankedTaskAssignment;

#[async_trait]
impl TaskAssignmentStrategy for LlmRankedTaskAssignment {
    async fn select_next_task(
        &self,
        ready_tasks: &[Task],
        context: &TaskAssignmentContext,
    ) -> Result<Uuid, AutoPickupError> {
        let api_key = std::env::var("ANTHROPIC_API_KEY").map_err(|_| {
            AutoPickupError::Config(
                "ANTHROPIC_API_KEY not set, falling back to simple selection".into(),
            )
        })?;

        let prompt = build_ranking_prompt(ready_tasks, context);

        let body = serde_json::json!({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 256,
            "system": "You are a task prioritization assistant. Given a list of ready tasks and context about completed and in-progress work, select the single best task to work on next. Respond with ONLY the task UUID, nothing else.",
            "messages": [{"role": "user", "content": prompt}],
        });

        let client = reqwest::Client::new();
        let resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AutoPickupError::LlmError(format!("API request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AutoPickupError::LlmError(format!(
                "Anthropic API returned {status}: {body}"
            )));
        }

        let result: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AutoPickupError::LlmError(format!("Failed to parse response: {e}")))?;

        // Extract text from the response
        let text = result["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .trim()
            .to_string();

        // Try to parse the UUID from the response
        let selected_id = Uuid::parse_str(&text).or_else(|_| {
            // Try to find a UUID anywhere in the response text
            for word in text.split_whitespace() {
                if let Ok(id) =
                    Uuid::parse_str(word.trim_matches(|c: char| !c.is_alphanumeric() && c != '-'))
                {
                    // Verify this is actually one of the ready tasks
                    if ready_tasks.iter().any(|t| t.id == id) {
                        return Ok(id);
                    }
                }
            }
            Err(AutoPickupError::LlmError(format!(
                "Could not parse task UUID from LLM response: {text}"
            )))
        })?;

        // Verify the selected task is actually in the ready list
        if !ready_tasks.iter().any(|t| t.id == selected_id) {
            return Err(AutoPickupError::LlmError(format!(
                "LLM selected task {selected_id} which is not in the ready list"
            )));
        }

        Ok(selected_id)
    }
}

fn build_ranking_prompt(ready_tasks: &[Task], context: &TaskAssignmentContext) -> String {
    let mut prompt = String::new();

    prompt.push_str(&format!(
        "Just completed: \"{}\"",
        context.completed_task.title
    ));
    if let Some(desc) = &context.completed_task.description {
        if !desc.is_empty() {
            prompt.push_str(&format!("\n  Description: {desc}"));
        }
    }

    if !context.done_tasks.is_empty() {
        prompt.push_str("\n\nPreviously completed tasks:");
        for t in &context.done_tasks {
            prompt.push_str(&format!("\n- {}", t.title));
        }
    }

    if !context.in_progress_tasks.is_empty() {
        prompt.push_str("\n\nCurrently in progress:");
        for t in &context.in_progress_tasks {
            prompt.push_str(&format!("\n- {}", t.title));
        }
    }

    prompt.push_str("\n\nReady tasks to choose from:");
    for t in ready_tasks {
        prompt.push_str(&format!("\n- UUID: {}", t.id));
        prompt.push_str(&format!("  Title: \"{}\"", t.title));
        if let Some(desc) = &t.description {
            if !desc.is_empty() {
                prompt.push_str(&format!("  Description: {desc}"));
            }
        }
    }

    prompt.push_str("\n\nWhich task UUID should be worked on next? Consider dependencies, logical order, and what has already been built. Respond with ONLY the UUID.");

    prompt
}

/// Determine which task to pick up next. Uses simple selection for 1 task,
/// LLM ranking for multiple tasks (with simple fallback on LLM failure).
pub async fn select_next_task(
    ready_tasks: &[Task],
    context: &TaskAssignmentContext,
) -> Result<Uuid, AutoPickupError> {
    if ready_tasks.is_empty() {
        return Err(AutoPickupError::NoReadyTasks);
    }

    if ready_tasks.len() == 1 {
        return SimpleTaskAssignment
            .select_next_task(ready_tasks, context)
            .await;
    }

    // Multiple ready tasks — try LLM, fall back to simple
    match LlmRankedTaskAssignment
        .select_next_task(ready_tasks, context)
        .await
    {
        Ok(id) => Ok(id),
        Err(e) => {
            tracing::warn!("LLM task ranking failed, falling back to sort order: {e}");
            SimpleTaskAssignment
                .select_next_task(ready_tasks, context)
                .await
        }
    }
}

/// Check if auto-pickup should run and select the next task.
/// Returns None if auto-pickup is disabled, no ready tasks, or the workspace has no linked task.
///
/// Behavior depends on the type of task that was just completed:
///
/// **Subtask completed (has parent_task_id):**
/// - If sibling subtasks remain in "ready" → return None (don't auto-pick during subtask work)
/// - If all siblings are done (parent fully completed) → search for ready top-level tasks
///   filtered by agent: only tasks assigned to the completing agent or unassigned
///
/// **Non-subtask completed (standalone or parent task):**
/// - Priority 1: Ready child sub-tasks of the completed task (keeps work focused)
/// - Priority 2: General ready tasks in the project (excluding sub-tasks)
///
/// The selected task is atomically claimed (transitioned to in_progress) to prevent
/// race conditions when multiple agents complete simultaneously.
pub async fn try_select_next_task(
    db: &DBService,
    workspace_task_id: Uuid,
) -> Result<Option<AutoPickupResult>, AutoPickupError> {
    let pool = &db.pool;

    // Get the completed task
    let completed_task = Task::find_by_id(pool, workspace_task_id)
        .await
        .map_err(AutoPickupError::Db)?
        .ok_or(AutoPickupError::TaskNotFound(workspace_task_id))?;

    let project_id = completed_task.project_id;

    // Check project-level toggle
    let project = Project::find_by_id(pool, project_id)
        .await
        .map_err(AutoPickupError::Db)?
        .ok_or(AutoPickupError::ProjectNotFound(project_id))?;

    if !project.auto_pickup_enabled {
        tracing::debug!("Auto-pickup disabled for project {project_id}");
        return Ok(None);
    }

    // Check if the completed task is a sub-task
    let parent_task_id: Option<Uuid> =
        sqlx::query_scalar("SELECT parent_task_id FROM tasks WHERE id = ?")
            .bind(workspace_task_id)
            .fetch_optional(pool)
            .await
            .map_err(AutoPickupError::Db)?
            .flatten();

    let candidate_tasks = if let Some(parent_id) = parent_task_id {
        // Completed task IS a subtask — check for ready siblings
        let ready_siblings = find_ready_subtasks(pool, parent_id).await?;

        if !ready_siblings.is_empty() {
            // Siblings remain — pick the next one
            tracing::debug!(
                "Auto-pickup: {} ready sibling(s) remain under parent {parent_id}, picking next",
                ready_siblings.len()
            );
            ready_siblings
        } else {
        // Parent fully completed (no ready siblings) — agent-filtered search
        let completing_agent = get_crew_member_id(pool, workspace_task_id).await?;
        tracing::debug!(
            "Auto-pickup: parent {parent_id} fully completed, searching for agent-filtered tasks (agent: {:?})",
            completing_agent
        );
        let filtered = find_ready_tasks_for_agent(pool, project_id, completing_agent.as_deref()).await?;

        if filtered.is_empty() {
            tracing::debug!("No eligible ready tasks for completing agent");
            return Ok(None);
        }

        filtered
        }
    } else {
        // Completed task is NOT a subtask — existing priority logic
        // Priority 1: Check for ready child sub-tasks
        let sub_tasks = find_ready_subtasks(pool, workspace_task_id).await?;

        if !sub_tasks.is_empty() {
            tracing::debug!(
                "Auto-pickup: found {} ready sub-task(s) of parent {workspace_task_id}",
                sub_tasks.len()
            );
            sub_tasks
        } else {
            // Priority 2: General ready tasks, filtering out sub-tasks
            let all_ready = Task::find_by_project_and_status(pool, project_id, "ready")
                .await
                .map_err(AutoPickupError::Db)?;

            if all_ready.is_empty() {
                tracing::debug!("No ready tasks in project {project_id}");
                return Ok(None);
            }

            let subtask_ids = find_all_subtask_ids(pool, project_id).await?;
            if !subtask_ids.is_empty() {
                tracing::debug!(
                    "Auto-pickup: filtering out {} sub-task(s) from general pool",
                    subtask_ids.len()
                );
            }

            let filtered: Vec<Task> = all_ready
                .into_iter()
                .filter(|t| !subtask_ids.contains(&t.id))
                .collect();

            if filtered.is_empty() {
                tracing::debug!("No eligible ready tasks after filtering sub-tasks");
                return Ok(None);
            }

            filtered
        }
    };

    // Build context for the strategy
    let done_tasks = Task::find_by_project_and_status(pool, project_id, "done")
        .await
        .map_err(AutoPickupError::Db)?;
    let in_progress_tasks = Task::find_by_project_and_status(pool, project_id, "in_progress")
        .await
        .map_err(AutoPickupError::Db)?;

    let context = TaskAssignmentContext {
        completed_task,
        done_tasks,
        in_progress_tasks,
    };

    let selected_id = select_next_task(&candidate_tasks, &context).await?;

    let selected_task = candidate_tasks
        .into_iter()
        .find(|t| t.id == selected_id)
        .ok_or(AutoPickupError::TaskNotFound(selected_id))?;

    // Atomic claim: transition the task from "ready" to "in_progress".
    // If another agent already claimed it (0 rows affected), bail out.
    let claim_result = sqlx::query(
        "UPDATE tasks SET status = 'in_progress', updated_at = datetime('now', 'subsec') WHERE id = ? AND status = 'ready'",
    )
    .bind(selected_task.id)
    .execute(pool)
    .await
    .map_err(AutoPickupError::Db)?;

    if claim_result.rows_affected() == 0 {
        tracing::warn!(
            "Auto-pickup: task \"{}\" ({}) was claimed by another agent",
            selected_task.title,
            selected_task.id
        );
        return Ok(None);
    }

    // Fetch the parent_task_id for the selected task
    let parent_task_id: Option<Uuid> =
        sqlx::query_scalar("SELECT parent_task_id FROM tasks WHERE id = ?")
            .bind(selected_task.id)
            .fetch_optional(pool)
            .await
            .map_err(AutoPickupError::Db)?
            .flatten();

    Ok(Some(AutoPickupResult {
        selected_task_id: selected_task.id,
        selected_task_title: selected_task.title.clone(),
        parent_task_id,
    }))
}

/// Get the crew_member_id for a task (the agent assigned to it).
async fn get_crew_member_id(
    pool: &sqlx::SqlitePool,
    task_id: Uuid,
) -> Result<Option<String>, AutoPickupError> {
    // Returns Option<Option<String>>:
    //   None = task not found, Some(None) = unassigned, Some(Some(id)) = assigned
    let result: Option<Option<String>> =
        sqlx::query_scalar("SELECT crew_member_id FROM tasks WHERE id = ?")
            .bind(task_id)
            .fetch_optional(pool)
            .await
            .map_err(AutoPickupError::Db)?;

    match result {
        None => Err(AutoPickupError::TaskNotFound(task_id)),
        Some(inner) => Ok(inner),
    }
}

/// Find ready top-level tasks (no parent) assigned to the given agent or unassigned.
/// When `agent_id` is None, only unassigned tasks are returned.
async fn find_ready_tasks_for_agent(
    pool: &sqlx::SqlitePool,
    project_id: Uuid,
    agent_id: Option<&str>,
) -> Result<Vec<Task>, AutoPickupError> {
    match agent_id {
        Some(id) => {
            sqlx::query_as::<_, Task>(
                r#"SELECT id, project_id, title, description, status, parent_workspace_id, created_at, updated_at
                   FROM tasks
                   WHERE project_id = ? AND status = 'ready'
                     AND parent_task_id IS NULL
                     AND (crew_member_id = ? OR crew_member_id IS NULL)
                   ORDER BY sort_order ASC, created_at ASC"#,
            )
            .bind(project_id)
            .bind(id)
            .fetch_all(pool)
            .await
            .map_err(AutoPickupError::Db)
        }
        None => {
            sqlx::query_as::<_, Task>(
                r#"SELECT id, project_id, title, description, status, parent_workspace_id, created_at, updated_at
                   FROM tasks
                   WHERE project_id = ? AND status = 'ready'
                     AND parent_task_id IS NULL
                     AND crew_member_id IS NULL
                   ORDER BY sort_order ASC, created_at ASC"#,
            )
            .bind(project_id)
            .fetch_all(pool)
            .await
            .map_err(AutoPickupError::Db)
        }
    }
}

/// Find ready sub-tasks of a given parent task.
async fn find_ready_subtasks(
    pool: &sqlx::SqlitePool,
    parent_task_id: Uuid,
) -> Result<Vec<Task>, AutoPickupError> {
    // Query tasks that are sub-issues of the given parent and in "ready" status.
    // Uses the Task struct columns (parent_task_id is only in WHERE, not SELECT).
    sqlx::query_as::<_, Task>(
        r#"SELECT id, project_id, title, description, status, parent_workspace_id, created_at, updated_at
           FROM tasks
           WHERE parent_task_id = ? AND status = 'ready'
           ORDER BY parent_task_sort_order ASC, created_at ASC"#,
    )
    .bind(parent_task_id)
    .fetch_all(pool)
    .await
    .map_err(AutoPickupError::Db)
}

/// Find all ready sub-task IDs in a project. Sub-tasks (tasks with a parent_task_id)
/// are excluded from the general auto-pickup pool — they should only be picked up
/// via Priority 1 when their parent's workspace completes.
async fn find_all_subtask_ids(
    pool: &sqlx::SqlitePool,
    project_id: Uuid,
) -> Result<Vec<Uuid>, AutoPickupError> {
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        r#"SELECT t.id
           FROM tasks t
           WHERE t.project_id = ?
             AND t.status = 'ready'
             AND t.parent_task_id IS NOT NULL"#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(AutoPickupError::Db)?;

    Ok(rows.into_iter().map(|(id,)| id).collect())
}

#[derive(Debug, thiserror::Error)]
pub enum AutoPickupError {
    #[error("No ready tasks available")]
    NoReadyTasks,
    #[error("Task not found: {0}")]
    TaskNotFound(Uuid),
    #[error("Project not found: {0}")]
    ProjectNotFound(Uuid),
    #[error("Database error: {0}")]
    Db(sqlx::Error),
    #[error("Configuration error: {0}")]
    Config(String),
    #[error("LLM ranking error: {0}")]
    LlmError(String),
    #[error("Workspace creation failed: {0}")]
    WorkspaceCreation(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_db() -> DBService {
        let pool = db::test_pool().await;
        DBService { pool }
    }

    async fn insert_project(pool: &sqlx::SqlitePool, id: Uuid, auto_pickup: bool) {
        sqlx::query(
            "INSERT INTO projects (id, name, auto_pickup_enabled) VALUES (?, 'Test Project', ?)",
        )
        .bind(id)
        .bind(auto_pickup)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_crew_member(pool: &sqlx::SqlitePool, id: &str) {
        sqlx::query(
            "INSERT INTO crew_members (id, name, role) VALUES (?, 'Agent', 'developer')",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_task(
        pool: &sqlx::SqlitePool,
        id: Uuid,
        project_id: Uuid,
        status: &str,
        parent_task_id: Option<Uuid>,
        crew_member_id: Option<&str>,
    ) {
        sqlx::query(
            r#"INSERT INTO tasks (id, project_id, title, status, parent_task_id, crew_member_id)
               VALUES (?, ?, 'Task', ?, ?, ?)"#,
        )
        .bind(id)
        .bind(project_id)
        .bind(status)
        .bind(parent_task_id)
        .bind(crew_member_id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn parent_complete_picks_agent_assigned_ticket() {
        let db = setup_db().await;
        let pool = &db.pool;

        let project_id = Uuid::new_v4();
        let parent_id = Uuid::new_v4();
        let subtask_id = Uuid::new_v4(); // the just-completed subtask
        let ready_ticket_id = Uuid::new_v4(); // assigned to same agent
        let agent_id = Uuid::new_v4().to_string();

        insert_project(pool, project_id, true).await;
        insert_crew_member(pool, &agent_id).await;

        // Parent task (in_progress)
        insert_task(pool, parent_id, project_id, "in_progress", None, Some(&agent_id)).await;
        // Completed subtask (done) — the one the agent just finished
        insert_task(pool, subtask_id, project_id, "done", Some(parent_id), Some(&agent_id)).await;
        // Ready top-level ticket assigned to the same agent
        insert_task(pool, ready_ticket_id, project_id, "ready", None, Some(&agent_id)).await;

        let result = try_select_next_task(&db, subtask_id).await.unwrap();
        assert!(result.is_some(), "should select the agent-assigned ready ticket");
        assert_eq!(result.unwrap().selected_task_id, ready_ticket_id);
    }

    #[tokio::test]
    async fn parent_complete_picks_unassigned_ticket() {
        let db = setup_db().await;
        let pool = &db.pool;

        let project_id = Uuid::new_v4();
        let parent_id = Uuid::new_v4();
        let subtask_id = Uuid::new_v4();
        let unassigned_ticket_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4().to_string();

        insert_project(pool, project_id, true).await;
        insert_crew_member(pool, &agent_id).await;

        insert_task(pool, parent_id, project_id, "in_progress", None, Some(&agent_id)).await;
        insert_task(pool, subtask_id, project_id, "done", Some(parent_id), Some(&agent_id)).await;
        // Ready top-level ticket with NO assignee
        insert_task(pool, unassigned_ticket_id, project_id, "ready", None, None).await;

        let result = try_select_next_task(&db, subtask_id).await.unwrap();
        assert!(result.is_some(), "should select the unassigned ready ticket");
        assert_eq!(result.unwrap().selected_task_id, unassigned_ticket_id);
    }

    #[tokio::test]
    async fn parent_complete_skips_other_agents_tickets() {
        let db = setup_db().await;
        let pool = &db.pool;

        let project_id = Uuid::new_v4();
        let parent_id = Uuid::new_v4();
        let subtask_id = Uuid::new_v4();
        let other_agent_ticket_id = Uuid::new_v4();
        let agent_a = Uuid::new_v4().to_string();
        let agent_b = Uuid::new_v4().to_string();

        insert_project(pool, project_id, true).await;
        insert_crew_member(pool, &agent_a).await;
        insert_crew_member(pool, &agent_b).await;

        insert_task(pool, parent_id, project_id, "in_progress", None, Some(&agent_a)).await;
        insert_task(pool, subtask_id, project_id, "done", Some(parent_id), Some(&agent_a)).await;
        // Ready ticket assigned to a DIFFERENT agent
        insert_task(pool, other_agent_ticket_id, project_id, "ready", None, Some(&agent_b)).await;

        let result = try_select_next_task(&db, subtask_id).await.unwrap();
        assert!(result.is_none(), "should NOT pick ticket assigned to another agent");
    }

    #[tokio::test]
    async fn subtask_completion_with_siblings_remaining_picks_next_sibling() {
        let db = setup_db().await;
        let pool = &db.pool;

        let project_id = Uuid::new_v4();
        let parent_id = Uuid::new_v4();
        let done_subtask_id = Uuid::new_v4(); // just completed
        let ready_sibling_id = Uuid::new_v4(); // still ready
        let unrelated_ready_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4().to_string();

        insert_project(pool, project_id, true).await;
        insert_crew_member(pool, &agent_id).await;

        insert_task(pool, parent_id, project_id, "in_progress", None, Some(&agent_id)).await;
        insert_task(pool, done_subtask_id, project_id, "done", Some(parent_id), Some(&agent_id)).await;
        // A sibling subtask still in "ready" — should be picked next
        insert_task(pool, ready_sibling_id, project_id, "ready", Some(parent_id), Some(&agent_id)).await;
        // An unrelated ready ticket — should NOT be picked (sibling takes priority)
        insert_task(pool, unrelated_ready_id, project_id, "ready", None, Some(&agent_id)).await;

        let result = try_select_next_task(&db, done_subtask_id).await.unwrap();
        assert!(result.is_some(), "should auto-pick the next ready sibling");
        assert_eq!(result.unwrap().selected_task_id, ready_sibling_id);
    }
}

use async_trait::async_trait;
use db::{
    DBService,
    models::{
        project::Project,
        task::Task,
    },
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
            AutoPickupError::Config("ANTHROPIC_API_KEY not set, falling back to simple selection".into())
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
                if let Ok(id) = Uuid::parse_str(word.trim_matches(|c: char| !c.is_alphanumeric() && c != '-')) {
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
        return SimpleTaskAssignment.select_next_task(ready_tasks, context).await;
    }

    // Multiple ready tasks — try LLM, fall back to simple
    match LlmRankedTaskAssignment.select_next_task(ready_tasks, context).await {
        Ok(id) => Ok(id),
        Err(e) => {
            tracing::warn!("LLM task ranking failed, falling back to sort order: {e}");
            SimpleTaskAssignment.select_next_task(ready_tasks, context).await
        }
    }
}

/// Check if auto-pickup should run and select the next task.
/// Returns None if auto-pickup is disabled, no ready tasks, or the workspace has no linked task.
///
/// Priority order:
/// 1. Ready sub-tasks of the just-completed task (keeps work focused)
/// 2. General ready tasks in the project (excluding sub-tasks with active parent workspaces)
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

    // Priority 1: Check for ready sub-tasks of the just-completed task
    let sub_tasks = find_ready_subtasks(pool, workspace_task_id).await?;

    let candidate_tasks = if !sub_tasks.is_empty() {
        tracing::debug!(
            "Auto-pickup: found {} ready sub-task(s) of completed task {workspace_task_id}",
            sub_tasks.len()
        );
        sub_tasks
    } else {
        // Priority 2: General ready tasks, filtering out those with active parent workspaces
        let all_ready = Task::find_by_project_and_status(pool, project_id, "ready")
            .await
            .map_err(AutoPickupError::Db)?;

        if all_ready.is_empty() {
            tracing::debug!("No ready tasks in project {project_id}");
            return Ok(None);
        }

        // Filter out ALL sub-tasks from the general pool. Sub-tasks should only be
        // picked up via Priority 1 (by the parent's own workspace completing), never
        // by an unrelated agent finishing a different ticket.
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

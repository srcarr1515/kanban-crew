use axum::{
    Router,
    body::Body,
    extract::{Json, Path, Query, State},
    response::{Json as ResponseJson, Response},
    routing::{delete, get, post},
};
use chrono::{DateTime, Utc};
use deployment::Deployment;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::{Column, FromRow, Row};
use tokio::io::AsyncBufReadExt;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

// ── DB types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChatThread {
    pub id: String,
    pub project_id: Uuid,
    pub issue_id: Option<String>,
    pub crew_member_id: Option<Uuid>,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChatMessage {
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content: String,
    pub metadata: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ── Request types ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ListThreadsQuery {
    pub project_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct CreateThreadRequest {
    pub project_id: Uuid,
    pub issue_id: Option<String>,
    pub title: Option<String>,
    pub crew_member_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateThreadRequest {
    pub title: Option<String>,
    pub crew_member_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ListMessagesQuery {
    pub thread_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ImageAttachment {
    pub base64: String,
    pub mime_type: String,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub thread_id: String,
    pub content: String,
    pub crew_member_id: Option<Uuid>,
    pub images: Option<Vec<ImageAttachment>>,
}

// ── Router ──────────────────────────────────────────────────────────────────

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/local/chat/threads", get(list_threads))
        .route("/local/chat/threads", post(create_thread))
        .route("/local/chat/threads/{id}", delete(delete_thread))
        .route("/local/chat/threads/{id}/title", post(update_thread_title))
        .route("/local/chat/messages", get(list_messages))
        .route("/local/chat/completions", post(chat_completion))
        .route("/local/chat/query", post(execute_readonly_query))
}

// ── Thread handlers ─────────────────────────────────────────────────────────

async fn list_threads(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ListThreadsQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatThread>>>, ApiError> {
    let pool = &deployment.db().pool;

    let threads = sqlx::query_as::<_, ChatThread>(
        "SELECT id, project_id, issue_id, crew_member_id, title, created_at, updated_at
         FROM chat_threads WHERE project_id = ? ORDER BY updated_at DESC",
    )
    .bind(&query.project_id)
    .fetch_all(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(threads)))
}

async fn create_thread(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateThreadRequest>,
) -> Result<ResponseJson<ApiResponse<ChatThread>>, ApiError> {
    let pool = &deployment.db().pool;
    let id = Uuid::new_v4().to_string();
    let title = request.title.unwrap_or_else(|| "New Chat".to_string());

    let thread = sqlx::query_as::<_, ChatThread>(
        "INSERT INTO chat_threads (id, project_id, issue_id, crew_member_id, title)
         VALUES (?, ?, ?, ?, ?)
         RETURNING id, project_id, issue_id, crew_member_id, title, created_at, updated_at",
    )
    .bind(&id)
    .bind(&request.project_id)
    .bind(&request.issue_id)
    .bind(&request.crew_member_id)
    .bind(&title)
    .fetch_one(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(thread)))
}

async fn delete_thread(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;

    sqlx::query("DELETE FROM chat_threads WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

async fn update_thread_title(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
    Json(request): Json<UpdateThreadRequest>,
) -> Result<ResponseJson<ApiResponse<ChatThread>>, ApiError> {
    let pool = &deployment.db().pool;

    let thread = sqlx::query_as::<_, ChatThread>(
        "UPDATE chat_threads
         SET title = COALESCE(?, title),
             crew_member_id = COALESCE(?, crew_member_id),
             updated_at = datetime('now', 'subsec')
         WHERE id = ?
         RETURNING id, project_id, issue_id, crew_member_id, title, created_at, updated_at",
    )
    .bind(&request.title)
    .bind(&request.crew_member_id)
    .bind(&id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest(format!("Thread {id} not found")))?;

    Ok(ResponseJson(ApiResponse::success(thread)))
}

// ── Message handlers ────────────────────────────────────────────────────────

async fn list_messages(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatMessage>>>, ApiError> {
    let pool = &deployment.db().pool;

    let messages = sqlx::query_as::<_, ChatMessage>(
        "SELECT id, thread_id, role, content, metadata, created_at
         FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC",
    )
    .bind(&query.thread_id)
    .fetch_all(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(messages)))
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT: &str = "\
You are a helpful project planning assistant embedded in a Kanban board app. \
Help the user brainstorm features, discuss implementation strategies, and manage tasks.\n\n\
# Creating Tickets\n\
When the user asks you to create tickets or plan work, respond with a structured proposal using this EXACT JSON format embedded in your response:\n\n\
```proposal\n\
{\"tickets\": [{\"title\": \"Parent task\", \"description\": \"What to do\", \"status\": \"todo\", \"subtasks\": [{\"title\": \"Child step\", \"description\": \"Sub-step detail\", \"status\": \"todo\"}]}]}\n\
```\n\n\
Always include a proposal block when suggesting concrete tasks. The user will see a confirmation card and can choose to create the tickets. \
Keep ticket titles concise and descriptions actionable. Use status \"todo\" for new work.\n\n\
Grouping rules:\n\
- Use separate top-level tickets for distinct, unrelated work items.\n\
- Use subtasks when a ticket has implementation steps that belong together as a batch (e.g. backend + frontend for the same feature, or setup + implementation + tests for one piece of work).\n\
- Omit the subtasks field entirely for simple, self-contained tickets.\n\
- Subtasks should not have their own subtasks — keep the hierarchy to one level deep.\n\n\
# Modifying Tickets\n\
When the user asks you to update, modify, rename, change the description, or move a ticket to a different status, respond with:\n\n\
```modify_proposal\n\
{\"modifications\": [{\"task_id\": \"the-task-id\", \"title\": \"Updated title\", \"description\": \"Updated description\", \"status\": \"ready\"}]}\n\
```\n\n\
Only include fields that should change — omit fields that stay the same. The task_id field is always required.\n\n\
# Deleting Tickets\n\
When the user asks you to delete or remove a ticket, respond with:\n\n\
```delete_proposal\n\
{\"deletions\": [{\"task_id\": \"the-task-id\", \"title\": \"Task title for confirmation\"}]}\n\
```\n\n\
The user will see a confirmation card before any modifications or deletions are applied. \
Never modify or delete tickets without using the proposal format — always let the user confirm first.\n\n\
# Querying the Database\n\
You can research data in the database by writing read-only SQL queries. Wrap your query in a special code block:\n\n\
```query\n\
SELECT id, title, status FROM tasks WHERE project_id = ? LIMIT 20\n\
```\n\n\
The user will see a \"Run Query\" button and can execute it to see the results as a table. \
Only SELECT, WITH, and EXPLAIN queries are allowed — no mutations. Results are capped at 500 rows.\n\n\
## Database Schema\n\
The database is SQLite. Key tables:\n\n\
**projects** — id (BLOB/UUID), name (TEXT), created_at, updated_at\n\
**tasks** — id (BLOB/UUID), project_id (BLOB FK→projects), title (TEXT), description (TEXT), status (TEXT: todo/ready/in_progress/in_review/done/cancelled), sort_order (INT), parent_task_id (BLOB, optional FK→tasks), parent_task_sort_order (REAL), created_at, updated_at\n\
**chat_threads** — id (TEXT), project_id (BLOB FK→projects), issue_id (TEXT), crew_member_id (BLOB FK→crew_members), title (TEXT), created_at, updated_at\n\
**chat_messages** — id (TEXT), thread_id (TEXT FK→chat_threads), role (TEXT: user/assistant/system), content (TEXT), metadata (TEXT), created_at\n\
**crew_members** — id (BLOB/UUID), name (TEXT), role (TEXT), avatar (TEXT), role_prompt (TEXT), tool_access (TEXT/JSON), personality (TEXT), ai_provider (TEXT), ai_model (TEXT), can_create_workspace (BOOL), can_merge_workspace (BOOL), can_propose_tasks (BOOL), can_query_database (BOOL), created_at, updated_at\n\
**workspaces** — id (BLOB/UUID), branch (TEXT), container_ref (TEXT), created_at, updated_at\n\
**sessions** — id (BLOB/UUID), workspace_id (BLOB FK→workspaces), executor (TEXT), created_at, updated_at\n\
**execution_processes** — id (BLOB/UUID), session_id (BLOB FK→sessions), run_reason (TEXT), executor_action (TEXT), status (TEXT), created_at, updated_at\n\n\
Note: BLOB id columns store UUIDs as binary. Use hex(id) to display them as readable strings, or cast with quote(id) if needed.\n\
When filtering by a known UUID string like 'abc-123-...', use the tasks/projects as shown in the Current Tasks section above — the id values listed there can be used directly.";

// ── AI completion (streaming) ───────────────────────────────────────────────

async fn chat_completion(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<SendMessageRequest>,
) -> Result<Response<Body>, ApiError> {
    let pool = &deployment.db().pool;

    // 1. Persist the user message (with image metadata if present)
    let user_msg_id = Uuid::new_v4().to_string();
    let metadata: Option<String> = request.images.as_ref().and_then(|imgs| {
        if imgs.is_empty() {
            return None;
        }
        let image_entries: Vec<serde_json::Value> = imgs
            .iter()
            .map(|img| {
                serde_json::json!({
                    "dataUrl": format!("data:{};base64,{}", img.mime_type, img.base64),
                    "mime_type": img.mime_type,
                })
            })
            .collect();
        Some(serde_json::json!({ "images": image_entries }).to_string())
    });
    sqlx::query(
        "INSERT INTO chat_messages (id, thread_id, role, content, metadata) VALUES (?, ?, 'user', ?, ?)",
    )
    .bind(&user_msg_id)
    .bind(&request.thread_id)
    .bind(&request.content)
    .bind(&metadata)
    .execute(pool)
    .await?;

    // Touch thread updated_at and lock crew_member_id on first message if provided
    sqlx::query(
        "UPDATE chat_threads
         SET crew_member_id = COALESCE(crew_member_id, ?),
             updated_at = datetime('now', 'subsec')
         WHERE id = ?",
    )
    .bind(&request.crew_member_id)
    .bind(&request.thread_id)
    .execute(pool)
    .await?;

    // 2. Load conversation history for this thread
    let history = sqlx::query_as::<_, ChatMessage>(
        "SELECT id, thread_id, role, content, metadata, created_at
         FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC",
    )
    .bind(&request.thread_id)
    .fetch_all(pool)
    .await?;

    // 3. Build system prompt — optionally augmented with crew member persona
    //    Also fetch per-member AI provider/model overrides.
    #[derive(sqlx::FromRow)]
    struct CrewMemberRow {
        name: String,
        role_prompt: String,
        personality: String,
        ai_provider: Option<String>,
        ai_model: Option<String>,
    }

    // Resolve effective crew_member_id: request param → thread's stored value
    let effective_crew_member_id = if request.crew_member_id.is_some() {
        request.crew_member_id
    } else {
        sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT crew_member_id FROM chat_threads WHERE id = ?",
        )
        .bind(&request.thread_id)
        .fetch_optional(pool)
        .await?
        .flatten()
    };

    let crew_row = if let Some(crew_id) = effective_crew_member_id {
        sqlx::query_as::<_, CrewMemberRow>(
            "SELECT name, role_prompt, personality, ai_provider, ai_model FROM crew_members WHERE id = ?",
        )
        .bind(crew_id)
        .fetch_optional(pool)
        .await?
    } else {
        None
    };

    // Resolve active skills for this crew member via the junction table
    let skills_section = if let Some(crew_id) = effective_crew_member_id {
        let active_skills = db::models::crew_member_skill::CrewMemberSkill::list_skills_for_crew_member(
            pool,
            &crew_id.to_string(),
        )
        .await
        .unwrap_or_default();

        if active_skills.is_empty() {
            String::new()
        } else {
            let mut section = String::from(
                "\n\n# Active Skills\n\
                 The following skills are loaded and you MUST follow their instructions:\n\n",
            );
            for (i, skill) in active_skills.iter().enumerate() {
                if i > 0 {
                    section.push_str("\n---\n\n");
                }
                section.push_str(&skill.content);
                section.push('\n');
            }
            section
        }
    } else {
        String::new()
    };

    // Only inject persona when the crew member has a non-empty role_prompt.
    // No role_prompt = current behavior unchanged.
    let has_persona = crew_row
        .as_ref()
        .map_or(false, |cm| !cm.role_prompt.trim().is_empty());

    let mut system_prompt = if has_persona {
        let cm = crew_row.as_ref().unwrap();
        let mut prompt = format!(
            "# Identity\n\
             You are \"{}\", a crew member on a software development team.\n\n\
             # Role & Expertise\n\
             {}\n\n",
            cm.name, cm.role_prompt
        );
        if !cm.personality.trim().is_empty() {
            prompt.push_str(&format!(
                "# Communication Style\n\
                 {}\n\n",
                cm.personality
            ));
        }
        prompt.push_str(&format!(
            "Stay in character at all times. Respond as {} would — \
             use the communication style described above and bring the expertise of your role \
             to every answer.\n",
            cm.name
        ));
        prompt.push_str(&skills_section);
        prompt.push_str("\n# Task Instructions\n");
        prompt.push_str(SYSTEM_PROMPT);
        prompt
    } else {
        let mut prompt = String::new();
        if !skills_section.is_empty() {
            prompt.push_str(&skills_section);
            prompt.push('\n');
        }
        prompt.push_str(SYSTEM_PROMPT);
        prompt
    };

    // Inject current task list so the AI can reference task IDs for modifications/deletions
    let thread_project_id: Option<Uuid> =
        sqlx::query_scalar("SELECT project_id FROM chat_threads WHERE id = ?")
            .bind(&request.thread_id)
            .fetch_optional(pool)
            .await?;

    if let Some(proj_id) = thread_project_id {
        let tasks: Vec<(String, String, Option<String>, String, Option<String>)> = sqlx::query_as(
            r#"SELECT id, title, description, status, parent_task_id
               FROM tasks WHERE project_id = ?
               ORDER BY parent_task_sort_order ASC, sort_order ASC, created_at ASC"#,
        )
        .bind(proj_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        if !tasks.is_empty() {
            system_prompt.push_str("\n\n# Current Tasks\nHere are the existing tasks on the board. Use these task_id values when proposing modifications or deletions:\n");
            for (id, title, _desc, status, parent_id) in &tasks {
                let indent = if parent_id.is_some() { "  " } else { "" };
                system_prompt.push_str(&format!(
                    "{}- [{}] {} (id: {})\n",
                    indent, status, title, id
                ));
            }
        }
    }

    // 4. Resolve AI provider: per-member override → global config → env fallback
    let config = deployment.config().read().await;
    let member_provider_id = crew_row.as_ref().and_then(|cm| cm.ai_provider.clone());
    let member_model = crew_row.as_ref().and_then(|cm| cm.ai_model.clone());

    let effective_provider_id =
        member_provider_id.or_else(|| config.ai_providers.default_provider.clone());
    let effective_model = member_model.or_else(|| config.ai_providers.default_model.clone());

    let images = request.images.as_deref();
    let has_images = images.map(|imgs| !imgs.is_empty()).unwrap_or(false);

    // 4b. Vision fallback: when images are present and a vision model is configured,
    //     swap in the vision provider/model so the request goes to a vision-capable model.
    let vision_config = &config.vision_model;
    let vision_fallback_meta: Option<serde_json::Value>;
    let (resolved_provider_id, resolved_model, resolved_api_key, resolved_base_url) =
        if has_images && vision_config.provider.is_some() && vision_config.model.is_some() {
            let vision_pid = vision_config.provider.clone().unwrap();
            let vision_model = vision_config.model.clone().unwrap();

            // Only fall back if the vision model differs from the effective model
            let needs_fallback = effective_provider_id.as_deref() != Some(vision_pid.as_str())
                || effective_model.as_deref() != Some(vision_model.as_str());

            if needs_fallback {
                let vision_entry = config
                    .ai_providers
                    .providers
                    .iter()
                    .find(|p| p.id == vision_pid && p.enabled);
                let api_key = vision_entry
                    .and_then(|p| p.api_key.clone())
                    .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok());
                let base_url = vision_entry.and_then(|p| p.base_url.clone());

                tracing::info!(
                    original_provider = ?effective_provider_id,
                    original_model = ?effective_model,
                    vision_provider = %vision_pid,
                    vision_model = %vision_model,
                    "Vision fallback: re-routing to vision model because images are attached"
                );

                vision_fallback_meta = Some(serde_json::json!({
                    "vision_fallback": true,
                    "original_provider": effective_provider_id,
                    "original_model": effective_model,
                    "vision_provider": vision_pid,
                    "vision_model": vision_model,
                }));

                (Some(vision_pid), Some(vision_model), api_key, base_url)
            } else {
                // Already using the vision model — no fallback needed
                let provider_entry = effective_provider_id.as_ref().and_then(|pid| {
                    config
                        .ai_providers
                        .providers
                        .iter()
                        .find(|p| &p.id == pid && p.enabled)
                });
                let api_key = provider_entry
                    .and_then(|p| p.api_key.clone())
                    .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok());
                let base_url = provider_entry.and_then(|p| p.base_url.clone());
                vision_fallback_meta = None;
                (effective_provider_id, effective_model, api_key, base_url)
            }
        } else {
            // No images or no vision model configured — normal resolution
            let provider_entry = effective_provider_id.as_ref().and_then(|pid| {
                config
                    .ai_providers
                    .providers
                    .iter()
                    .find(|p| &p.id == pid && p.enabled)
            });
            let api_key = provider_entry
                .and_then(|p| p.api_key.clone())
                .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok());
            let base_url = provider_entry.and_then(|p| p.base_url.clone());
            vision_fallback_meta = None;
            (effective_provider_id, effective_model, api_key, base_url)
        };

    // Drop the config lock before entering the streaming path
    drop(config);

    // If a non-CLI provider is configured, use the API backend
    if let Some(ref pid) = resolved_provider_id {
        // Any configured provider (anthropic, openai, google, etc.) uses the API path
        let api_key = resolved_api_key.ok_or_else(|| {
            ApiError::BadRequest(format!(
                "No API key configured for provider \"{pid}\". Set it in Settings > AI Providers."
            ))
        })?;
        let model = resolved_model.unwrap_or_else(|| match pid.as_str() {
            "openai" => "gpt-4o".to_string(),
            "google" => "gemini-2.0-flash".to_string(),
            _ => "claude-sonnet-4-20250514".to_string(),
        });
        let base_url = resolved_base_url.unwrap_or_else(|| match pid.as_str() {
            "openai" => "https://api.openai.com".to_string(),
            "google" => "https://generativelanguage.googleapis.com".to_string(),
            "openrouter" => "https://openrouter.ai/api".to_string(),
            _ => "https://api.anthropic.com".to_string(),
        });
        chat_completion_provider_api(
            pool,
            &request.thread_id,
            &history,
            &system_prompt,
            images,
            pid,
            &api_key,
            &base_url,
            &model,
            vision_fallback_meta.as_ref(),
        )
        .await
    } else {
        // No provider configured — use CLI backend (default).
        // If images are attached and a vision model is configured, the fallback
        // should have already routed us to the API path above. If we're still
        // here, no vision model was configured either — reject with a clear error.
        if has_images {
            return Err(ApiError::BadRequest(
                "The current chat backend (CLI) does not support image attachments. \
                 To send images, configure a Vision Model in Settings > AI Providers, \
                 or assign an AI provider with vision support to the crew member."
                    .to_string(),
            ));
        }
        chat_completion_cli(pool, &request.thread_id, &history, &system_prompt).await
    }
}

// ── Claude Code CLI backend ─────────────────────────────────────────────────

async fn chat_completion_cli(
    pool: &sqlx::SqlitePool,
    thread_id: &str,
    history: &[ChatMessage],
    system_prompt: &str,
) -> Result<Response<Body>, ApiError> {
    use std::process::Stdio;

    use tokio::process::Command;

    // Resolve the CLI executable using the same approach as the executor system.
    // utils::shell::resolve_executable_path handles Windows .cmd resolution properly.
    let base_cmd = std::env::var("CLAUDE_CLI_CMD").unwrap_or_else(|_| "npx".to_string());

    let program_path = utils::shell::resolve_executable_path(&base_cmd)
        .await
        .ok_or_else(|| ApiError::BadRequest(format!("Could not find executable: {base_cmd}")))?;

    // Detect if this is Claude Code CLI — it supports --system-prompt for proper
    // system context separation. Other CLIs (Codex, etc.) don't, so we embed the
    // system prompt in the conversation text as the universal fallback.
    let is_claude_cli = base_cmd == "npx"
        || base_cmd.contains("claude")
        || std::env::var("CHAT_CLI_TYPE")
            .map(|v| v == "claude")
            .unwrap_or(false);
    // Windows .cmd batch files mangle special characters in args, so always
    // embed via stdin there. On other platforms, use the flag if under arg limit.
    let use_system_flag =
        is_claude_cli && system_prompt.len() < 7000 && !cfg!(target_os = "windows");

    // Build conversation prompt
    let mut prompt = String::new();
    if !use_system_flag {
        // Embed system prompt in conversation text (universal approach)
        prompt.push_str(system_prompt);
        prompt.push_str("\n\n");
    }
    prompt.push_str("--- Conversation History ---\n");
    for msg in history {
        let role_label = match msg.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            _ => continue,
        };
        prompt.push_str(&format!("\n{role_label}: {}\n", msg.content));
    }
    prompt.push_str("\nAssistant: ");

    let mut cmd = Command::new(program_path);
    // If using npx (default), add the package args
    if base_cmd == "npx" {
        cmd.args(["-y", "@anthropic-ai/claude-code"]);
    }
    cmd.args([
        "--output-format=stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
    ]);
    // Claude Code CLI: use dedicated flag for proper system context separation
    if use_system_flag {
        cmd.args(["--system-prompt", system_prompt]);
    }
    // Use stdin for the prompt to avoid Windows .cmd argument escaping issues
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| ApiError::BadRequest(format!("Failed to spawn Claude CLI: {e}")))?;

    // Write the prompt to stdin — Claude CLI reads from stdin when no -p flag is given
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        let _ = stdin.write_all(prompt.as_bytes()).await;
        drop(stdin); // Close stdin so CLI knows input is complete
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::BadRequest("No stdout from Claude CLI".to_string()))?;

    let pool_clone = pool.clone();
    let thread_id_owned = thread_id.to_string();

    // Stream JSON lines from Claude CLI stdout → SSE to browser
    let stream = async_stream::stream! {
        let mut full_text = String::new();
        let reader = tokio::io::BufReader::new(stdout);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            // Each line is a JSON object from Claude CLI stream-json format
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");

                match event_type {
                    // assistant message with text content
                    "assistant" => {
                        if let Some(content) = event.get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_array())
                        {
                            for block in content {
                                if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                    if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                        full_text = text.to_string();
                                        // Send as SSE content_block_delta for frontend compatibility
                                        let sse_event = serde_json::json!({
                                            "type": "content_block_delta",
                                            "delta": { "text": text }
                                        });
                                        let sse_line = format!("data: {}\n\n", sse_event);
                                        yield Ok::<_, std::io::Error>(
                                            bytes::Bytes::from(sse_line)
                                        );
                                    }
                                }
                            }
                        }
                    }
                    // content_block_delta — partial text streaming
                    "content_block_delta" => {
                        if let Some(text) = event.get("delta")
                            .and_then(|d| d.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            full_text.push_str(text);
                            // Forward as SSE
                            let sse_event = serde_json::json!({
                                "type": "content_block_delta",
                                "delta": { "text": text }
                            });
                            let sse_line = format!("data: {}\n\n", sse_event);
                            yield Ok(bytes::Bytes::from(sse_line));
                        }
                    }
                    // result — final complete message
                    "result" => {
                        if let Some(result_text) = event.get("result")
                            .and_then(|r| r.as_str())
                        {
                            // If we haven't accumulated any streaming text, use the result
                            if full_text.is_empty() {
                                full_text = result_text.to_string();
                                let sse_event = serde_json::json!({
                                    "type": "content_block_delta",
                                    "delta": { "text": result_text }
                                });
                                let sse_line = format!("data: {}\n\n", sse_event);
                                yield Ok(bytes::Bytes::from(sse_line));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        // Send done marker
        yield Ok(bytes::Bytes::from("data: [DONE]\n\n"));

        // Wait for process to finish
        let _ = child.wait().await;

        // Persist the full assistant message
        if !full_text.is_empty() {
            let msg_id = Uuid::new_v4().to_string();
            let _ = sqlx::query(
                "INSERT INTO chat_messages (id, thread_id, role, content) VALUES (?, ?, 'assistant', ?)",
            )
            .bind(&msg_id)
            .bind(&thread_id_owned)
            .bind(&full_text)
            .execute(&pool_clone)
            .await;
        }
    };

    Ok(Response::builder()
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .header("connection", "keep-alive")
        .body(Body::from_stream(stream))
        .unwrap())
}

// ── Provider API backend (configurable) ──────────────────────────────────────

/// Whether a provider uses the OpenAI-compatible chat/completions format
/// or the Anthropic Messages API format.
fn is_openai_compatible(provider_id: &str) -> bool {
    matches!(provider_id, "openai" | "openrouter")
}

#[allow(clippy::too_many_arguments)]
async fn chat_completion_provider_api(
    pool: &sqlx::SqlitePool,
    thread_id: &str,
    history: &[ChatMessage],
    system_prompt: &str,
    images: Option<&[ImageAttachment]>,
    provider_id: &str,
    api_key: &str,
    base_url: &str,
    model: &str,
    vision_fallback: Option<&serde_json::Value>,
) -> Result<Response<Body>, ApiError> {
    let non_system: Vec<&ChatMessage> = history.iter().filter(|m| m.role != "system").collect();
    let last_idx = non_system.len().saturating_sub(1);

    let client = Client::new();

    let resp = if is_openai_compatible(provider_id) {
        // ── OpenAI-compatible format ─────────────────────────────────────
        let mut messages = vec![serde_json::json!({
            "role": "system",
            "content": system_prompt,
        })];
        for (i, m) in non_system.iter().enumerate() {
            let content = if i == last_idx
                && m.role == "user"
                && images.map(|imgs| !imgs.is_empty()).unwrap_or(false)
            {
                let imgs = images.unwrap();
                let mut parts: Vec<serde_json::Value> = imgs
                    .iter()
                    .map(|img| {
                        serde_json::json!({
                            "type": "image_url",
                            "image_url": {
                                "url": format!("data:{};base64,{}", img.mime_type, img.base64),
                            }
                        })
                    })
                    .collect();
                parts.push(serde_json::json!({"type": "text", "text": m.content}));
                serde_json::json!(parts)
            } else {
                serde_json::json!(m.content)
            };
            messages.push(serde_json::json!({"role": m.role, "content": content}));
        }

        let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
        client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("content-type", "application/json")
            .json(&serde_json::json!({
                "model": model,
                "max_tokens": 4096,
                "stream": true,
                "messages": messages,
            }))
            .send()
            .await
            .map_err(|e| ApiError::BadRequest(format!("Provider API error: {e}")))?
    } else {
        // ── Anthropic-compatible format ──────────────────────────────────
        let messages: Vec<serde_json::Value> = non_system
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let content = if i == last_idx
                    && m.role == "user"
                    && images.map(|imgs| !imgs.is_empty()).unwrap_or(false)
                {
                    let imgs = images.unwrap();
                    let mut blocks: Vec<serde_json::Value> = imgs
                        .iter()
                        .map(|img| {
                            serde_json::json!({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": img.mime_type,
                                    "data": img.base64,
                                }
                            })
                        })
                        .collect();
                    blocks.push(serde_json::json!({"type": "text", "text": m.content}));
                    serde_json::json!(blocks)
                } else {
                    serde_json::json!(m.content)
                };
                serde_json::json!({"role": m.role, "content": content})
            })
            .collect();

        let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
        client
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&serde_json::json!({
                "model": model,
                "max_tokens": 4096,
                "stream": true,
                "system": system_prompt,
                "messages": messages,
            }))
            .send()
            .await
            .map_err(|e| ApiError::BadRequest(format!("Anthropic API error: {e}")))?
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(ApiError::BadRequest(format!(
            "Provider API returned {status}: {body}"
        )));
    }

    let pool_clone = pool.clone();
    let thread_id_owned = thread_id.to_string();
    let byte_stream = resp.bytes_stream();
    let is_openai = is_openai_compatible(provider_id);
    let vision_fallback_owned = vision_fallback.cloned();

    let stream = async_stream::stream! {
        let mut full_text = String::new();
        let mut stream = std::pin::pin!(byte_stream);

        // Emit vision fallback metadata event before content so the frontend
        // knows which model is actually responding.
        if let Some(ref fb) = vision_fallback_owned {
            let sse_event = serde_json::json!({
                "type": "vision_fallback",
                "metadata": fb,
            });
            let sse_line = format!("data: {}\n\n", sse_event);
            yield Ok::<_, std::io::Error>(bytes::Bytes::from(sse_line));
        }

        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    yield Err(std::io::Error::new(std::io::ErrorKind::Other, e));
                    break;
                }
            };

            let text = String::from_utf8_lossy(&chunk);
            for line in text.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        continue;
                    }
                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                        if is_openai {
                            // OpenAI format: choices[0].delta.content
                            if let Some(delta_text) = event
                                .get("choices")
                                .and_then(|c| c.get(0))
                                .and_then(|c| c.get("delta"))
                                .and_then(|d| d.get("content"))
                                .and_then(|t| t.as_str())
                            {
                                full_text.push_str(delta_text);
                            }
                        } else {
                            // Anthropic format: content_block_delta
                            if event.get("type").and_then(|t| t.as_str())
                                == Some("content_block_delta")
                            {
                                if let Some(text_delta) = event
                                    .get("delta")
                                    .and_then(|d| d.get("text"))
                                    .and_then(|t| t.as_str())
                                {
                                    full_text.push_str(text_delta);
                                }
                            }
                        }
                    }
                }
            }

            if is_openai {
                // Normalize OpenAI SSE to the Anthropic format the frontend expects
                let text = String::from_utf8_lossy(&chunk);
                for line in text.lines() {
                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" { continue; }
                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(delta_text) = event
                                .get("choices")
                                .and_then(|c| c.get(0))
                                .and_then(|c| c.get("delta"))
                                .and_then(|d| d.get("content"))
                                .and_then(|t| t.as_str())
                            {
                                let sse_event = serde_json::json!({
                                    "type": "content_block_delta",
                                    "delta": { "text": delta_text }
                                });
                                let sse_line = format!("data: {}\n\n", sse_event);
                                yield Ok::<_, std::io::Error>(bytes::Bytes::from(sse_line));
                            }
                        }
                    }
                }
            } else {
                // Anthropic format — forward raw SSE bytes
                yield Ok(chunk);
            }
        }

        if is_openai {
            yield Ok(bytes::Bytes::from("data: [DONE]\n\n"));
        }

        // Persist the full assistant message (with vision fallback metadata if applicable)
        if !full_text.is_empty() {
            let msg_id = Uuid::new_v4().to_string();
            let msg_metadata = vision_fallback_owned.as_ref().map(|fb| fb.to_string());
            let _ = sqlx::query(
                "INSERT INTO chat_messages (id, thread_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)",
            )
            .bind(&msg_id)
            .bind(&thread_id_owned)
            .bind(&full_text)
            .bind(&msg_metadata)
            .execute(&pool_clone)
            .await;
        }
    };

    Ok(Response::builder()
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .header("connection", "keep-alive")
        .body(Body::from_stream(stream))
        .unwrap())
}

// ── Read-only query execution ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ExecuteQueryRequest {
    pub sql: String,
    /// When a crew member executes a query (via chat), pass their id so the
    /// server can enforce the `can_query_database` permission.
    pub crew_member_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
}

/// Execute a read-only SQL query against the database.
/// Only SELECT statements are allowed — any mutation is rejected.
async fn execute_readonly_query(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<ExecuteQueryRequest>,
) -> Result<ResponseJson<ApiResponse<QueryResult>>, ApiError> {
    // Permission check: if a crew member is specified, they must have can_query_database
    if let Some(member_id) = request.crew_member_id {
        let pool = &deployment.db().pool;
        let allowed: Option<bool> =
            sqlx::query_scalar("SELECT can_query_database FROM crew_members WHERE id = ?")
                .bind(member_id)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten();
        if allowed == Some(false) {
            return Err(ApiError::Forbidden(
                "This crew member does not have permission to query the database.".to_string(),
            ));
        }
    }

    let sql = request.sql.trim().to_string();

    // Validate the query is read-only by checking the first keyword
    let first_word = sql.split_whitespace().next().unwrap_or("").to_uppercase();

    if first_word != "SELECT" && first_word != "WITH" && first_word != "EXPLAIN" {
        return Err(ApiError::BadRequest(
            "Only SELECT, WITH, and EXPLAIN queries are allowed.".to_string(),
        ));
    }

    // Extra safety: reject if the query contains mutation keywords as standalone statements
    let upper = sql.to_uppercase();
    for forbidden in &[
        "INSERT ", "UPDATE ", "DELETE ", "DROP ", "ALTER ", "CREATE ", "REPLACE ", "ATTACH ",
        "DETACH ", "PRAGMA ", "VACUUM", "REINDEX",
    ] {
        for stmt in upper.split(';') {
            let trimmed = stmt.trim();
            if trimmed.starts_with(forbidden.trim()) {
                return Err(ApiError::BadRequest(format!(
                    "Query contains forbidden keyword: {}. Only read-only queries are allowed.",
                    forbidden.trim()
                )));
            }
        }
    }

    let pool = &deployment.db().pool;

    // Cap results to prevent unbounded memory usage
    let limited_sql = if upper.contains("LIMIT") {
        sql.clone()
    } else {
        format!("{} LIMIT 500", sql.trim_end_matches(';'))
    };

    let rows = sqlx::query(&limited_sql)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::BadRequest(format!("Query error: {e}")))?;

    let columns: Vec<String> = if rows.is_empty() {
        vec![]
    } else {
        rows[0]
            .columns()
            .iter()
            .map(|c: &sqlx::sqlite::SqliteColumn| c.name().to_string())
            .collect()
    };

    let mut result_rows: Vec<Vec<serde_json::Value>> = Vec::with_capacity(rows.len());
    for row in &rows {
        let mut values: Vec<serde_json::Value> = Vec::with_capacity(columns.len());
        for (i, _col) in columns.iter().enumerate() {
            let val: serde_json::Value = if let Ok(v) = row.try_get::<Option<String>, _>(i) {
                v.map(serde_json::Value::String)
                    .unwrap_or(serde_json::Value::Null)
            } else if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
                v.map(|n| serde_json::Value::Number(n.into()))
                    .unwrap_or(serde_json::Value::Null)
            } else if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
                v.and_then(|n| serde_json::Number::from_f64(n).map(serde_json::Value::Number))
                    .unwrap_or(serde_json::Value::Null)
            } else if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
                v.map(serde_json::Value::Bool)
                    .unwrap_or(serde_json::Value::Null)
            } else if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
                v.map(|b| {
                    serde_json::Value::String(
                        b.iter()
                            .map(|byte| format!("{byte:02x}"))
                            .collect::<String>(),
                    )
                })
                .unwrap_or(serde_json::Value::Null)
            } else {
                serde_json::Value::Null
            };
            values.push(val);
        }
        result_rows.push(values);
    }

    let row_count = result_rows.len();

    Ok(ResponseJson(ApiResponse::success(QueryResult {
        columns,
        rows: result_rows,
        row_count,
    })))
}

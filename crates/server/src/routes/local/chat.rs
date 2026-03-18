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
use sqlx::FromRow;
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
    pub crew_member_id: Option<String>,
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
    pub crew_member_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateThreadRequest {
    pub title: Option<String>,
    pub crew_member_id: Option<String>,
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
    pub crew_member_id: Option<String>,
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
Help the user brainstorm features, discuss implementation strategies, and break work into tasks.\n\n\
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
- Subtasks should not have their own subtasks — keep the hierarchy to one level deep.";

// ── AI completion (streaming) ───────────────────────────────────────────────

async fn chat_completion(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<SendMessageRequest>,
) -> Result<Response<Body>, ApiError> {
    let pool = &deployment.db().pool;

    // 1. Persist the user message
    let user_msg_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO chat_messages (id, thread_id, role, content) VALUES (?, ?, 'user', ?)",
    )
    .bind(&user_msg_id)
    .bind(&request.thread_id)
    .bind(&request.content)
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
    let system_prompt = if let Some(ref crew_id) = request.crew_member_id {
        let crew_uuid = Uuid::parse_str(crew_id)
            .map_err(|_| ApiError::BadRequest(format!("Invalid crew member ID: {crew_id}")))?;
        let crew_member: Option<(String, String, String)> =
            sqlx::query_as("SELECT name, role_prompt, personality FROM crew_members WHERE id = ?")
                .bind(crew_uuid)
                .fetch_optional(pool)
                .await?;

        if let Some((name, role_prompt, personality)) = crew_member {
            let mut prompt = format!(
                "# Identity\n\
                 You are \"{name}\", a crew member on a software development team.\n\n\
                 # Role & Expertise\n\
                 {role_prompt}\n\n\
                 # Communication Style\n\
                 {personality}\n\n\
                 Stay in character at all times. Respond as {name} would — \
                 use the communication style described above and bring the expertise of your role \
                 to every answer.\n\n\
                 # Task Instructions\n"
            );
            prompt.push_str(SYSTEM_PROMPT);
            prompt
        } else {
            SYSTEM_PROMPT.to_string()
        }
    } else {
        SYSTEM_PROMPT.to_string()
    };

    // 4. Decide backend: prefer Claude CLI, fall back to Anthropic API
    let use_cli = std::env::var("CHAT_BACKEND").unwrap_or_default() != "anthropic-api";

    let images = request.images.as_deref();

    if use_cli {
        chat_completion_cli(pool, &request.thread_id, &history, &system_prompt, images).await
    } else {
        chat_completion_anthropic_api(pool, &request.thread_id, &history, &system_prompt, images)
            .await
    }
}

// ── Claude Code CLI backend ─────────────────────────────────────────────────

async fn chat_completion_cli(
    pool: &sqlx::SqlitePool,
    thread_id: &str,
    history: &[ChatMessage],
    system_prompt: &str,
    images: Option<&[ImageAttachment]>,
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
    let history_len = history.len();
    for (i, msg) in history.iter().enumerate() {
        let role_label = match msg.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            _ => continue,
        };
        // For the last user message, note any attached images (CLI has no vision support)
        let suffix = if i + 1 == history_len
            && msg.role == "user"
            && images.map(|imgs| !imgs.is_empty()).unwrap_or(false)
        {
            format!(
                " [+{} image(s) attached]",
                images.map(|imgs| imgs.len()).unwrap_or(0)
            )
        } else {
            String::new()
        };
        prompt.push_str(&format!("\n{role_label}: {}{suffix}\n", msg.content));
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

// ── Anthropic API backend (fallback) ────────────────────────────────────────

async fn chat_completion_anthropic_api(
    pool: &sqlx::SqlitePool,
    thread_id: &str,
    history: &[ChatMessage],
    system_prompt: &str,
    images: Option<&[ImageAttachment]>,
) -> Result<Response<Body>, ApiError> {
    let api_key = std::env::var("ANTHROPIC_API_KEY").map_err(|_| {
        ApiError::BadRequest("ANTHROPIC_API_KEY environment variable is not set".to_string())
    })?;

    // For the last user message, build multipart content if images are attached
    let non_system: Vec<&ChatMessage> =
        history.iter().filter(|m| m.role != "system").collect();
    let last_idx = non_system.len().saturating_sub(1);

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

    let anthropic_body = serde_json::json!({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 4096,
        "stream": true,
        "system": system_prompt,
        "messages": messages,
    });

    let client = Client::new();
    let anthropic_resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&anthropic_body)
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Anthropic API error: {e}")))?;

    if !anthropic_resp.status().is_success() {
        let status = anthropic_resp.status();
        let body = anthropic_resp
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(ApiError::BadRequest(format!(
            "Anthropic API returned {status}: {body}"
        )));
    }

    let pool_clone = pool.clone();
    let thread_id_owned = thread_id.to_string();
    let byte_stream = anthropic_resp.bytes_stream();

    let stream = async_stream::stream! {
        let mut full_text = String::new();
        let mut stream = std::pin::pin!(byte_stream);

        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    yield Err(std::io::Error::new(std::io::ErrorKind::Other, e));
                    break;
                }
            };

            // Parse SSE events to accumulate text
            let text = String::from_utf8_lossy(&chunk);
            for line in text.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        continue;
                    }
                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
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

            // Forward raw SSE bytes to the browser
            yield Ok(chunk);
        }

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

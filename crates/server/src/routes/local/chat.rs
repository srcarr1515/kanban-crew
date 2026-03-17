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
}

#[derive(Debug, Deserialize)]
pub struct UpdateThreadRequest {
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListMessagesQuery {
    pub thread_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub thread_id: String,
    pub content: String,
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
        "SELECT id, project_id, issue_id, title, created_at, updated_at
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
        "INSERT INTO chat_threads (id, project_id, issue_id, title)
         VALUES (?, ?, ?, ?)
         RETURNING id, project_id, issue_id, title, created_at, updated_at",
    )
    .bind(&id)
    .bind(&request.project_id)
    .bind(&request.issue_id)
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
         SET title = COALESCE(?, title), updated_at = datetime('now', 'subsec')
         WHERE id = ?
         RETURNING id, project_id, issue_id, title, created_at, updated_at",
    )
    .bind(&request.title)
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
{\"tickets\": [{\"title\": \"Ticket title\", \"description\": \"What to do\", \"status\": \"todo\"}]}\n\
```\n\n\
Always include a proposal block when suggesting concrete tasks. The user will see a confirmation card and can choose to create the tickets. \
Keep ticket titles concise and descriptions actionable. Use status \"todo\" for new work.";

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

    // Touch thread updated_at
    sqlx::query("UPDATE chat_threads SET updated_at = datetime('now', 'subsec') WHERE id = ?")
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

    // 3. Decide backend: prefer Claude CLI, fall back to Anthropic API
    let use_cli = std::env::var("CHAT_BACKEND").unwrap_or_default() != "anthropic-api";

    if use_cli {
        chat_completion_cli(pool, &request.thread_id, &history).await
    } else {
        chat_completion_anthropic_api(pool, &request.thread_id, &history).await
    }
}

// ── Claude Code CLI backend ─────────────────────────────────────────────────

async fn chat_completion_cli(
    pool: &sqlx::SqlitePool,
    thread_id: &str,
    history: &[ChatMessage],
) -> Result<Response<Body>, ApiError> {
    use std::process::Stdio;

    use tokio::process::Command;

    // Build the conversation as a single prompt with context
    let mut prompt = format!("{SYSTEM_PROMPT}\n\n--- Conversation History ---\n");
    for msg in history {
        let role_label = match msg.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            _ => continue,
        };
        prompt.push_str(&format!("\n{role_label}: {}\n", msg.content));
    }
    prompt.push_str("\nAssistant: ");

    // Resolve the CLI executable using the same approach as the executor system.
    // utils::shell::resolve_executable_path handles Windows .cmd resolution properly.
    let base_cmd = std::env::var("CLAUDE_CLI_CMD").unwrap_or_else(|_| "npx".to_string());

    let program_path = utils::shell::resolve_executable_path(&base_cmd)
        .await
        .ok_or_else(|| ApiError::BadRequest(format!("Could not find executable: {base_cmd}")))?;

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
) -> Result<Response<Body>, ApiError> {
    let api_key = std::env::var("ANTHROPIC_API_KEY").map_err(|_| {
        ApiError::BadRequest("ANTHROPIC_API_KEY environment variable is not set".to_string())
    })?;

    let messages: Vec<serde_json::Value> = history
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            serde_json::json!({
                "role": m.role,
                "content": m.content,
            })
        })
        .collect();

    let anthropic_body = serde_json::json!({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 4096,
        "stream": true,
        "system": SYSTEM_PROMPT,
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

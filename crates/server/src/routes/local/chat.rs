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
    //    Also fetch per-member AI provider/model overrides.
    #[derive(sqlx::FromRow)]
    struct CrewMemberRow {
        name: String,
        role_prompt: String,
        personality: String,
        ai_provider: Option<String>,
        ai_model: Option<String>,
    }

    let crew_row = if let Some(crew_id) = request.crew_member_id {
        sqlx::query_as::<_, CrewMemberRow>(
            "SELECT name, role_prompt, personality, ai_provider, ai_model FROM crew_members WHERE id = ?",
        )
        .bind(crew_id)
        .fetch_optional(pool)
        .await?
    } else {
        None
    };

    let system_prompt = if let Some(ref cm) = crew_row {
        let mut prompt = format!(
            "# Identity\n\
             You are \"{}\", a crew member on a software development team.\n\n\
             # Role & Expertise\n\
             {}\n\n\
             # Communication Style\n\
             {}\n\n\
             Stay in character at all times. Respond as {} would — \
             use the communication style described above and bring the expertise of your role \
             to every answer.\n\n\
             # Task Instructions\n",
            cm.name, cm.role_prompt, cm.personality, cm.name
        );
        prompt.push_str(SYSTEM_PROMPT);
        prompt
    } else {
        SYSTEM_PROMPT.to_string()
    };

    // 4. Resolve AI provider: per-member override → global config → env fallback
    let config = deployment.config().read().await;
    let member_provider_id = crew_row.as_ref().and_then(|cm| cm.ai_provider.clone());
    let member_model = crew_row.as_ref().and_then(|cm| cm.ai_model.clone());

    let effective_provider_id =
        member_provider_id.or_else(|| config.ai_providers.default_provider.clone());
    let effective_model = member_model.or_else(|| config.ai_providers.default_model.clone());

    // Look up the provider entry for API key / base URL
    let provider_entry = effective_provider_id.as_ref().and_then(|pid| {
        config
            .ai_providers
            .providers
            .iter()
            .find(|p| &p.id == pid && p.enabled)
    });

    let resolved_api_key = provider_entry
        .and_then(|p| p.api_key.clone())
        .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok());
    let resolved_base_url = provider_entry.and_then(|p| p.base_url.clone());
    let resolved_model = effective_model;
    let resolved_provider_id = effective_provider_id;

    // Drop the config lock before entering the streaming path
    drop(config);

    let images = request.images.as_deref();

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
        )
        .await
    } else {
        // No provider configured — use CLI backend (default)
        chat_completion_cli(pool, &request.thread_id, &history, &system_prompt, images).await
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

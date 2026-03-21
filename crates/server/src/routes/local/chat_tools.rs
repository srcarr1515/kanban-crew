use std::path::{Path, PathBuf};

use sqlx::{Column, Row, SqlitePool};
use uuid::Uuid;

// ── Types ────────────────────────────────────────────────────────────────────

pub struct RepoInfo {
    pub name: String,
    pub path: PathBuf,
}

pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

pub struct ToolResult {
    pub tool_call_id: String,
    pub content: String,
    /// Human-readable 1-liner for the frontend status indicator.
    pub status_line: String,
    /// If set, this tool call should be emitted as an SSE event to the frontend
    /// rather than just shown as a status line. The value is the SSE event JSON.
    pub sse_event: Option<serde_json::Value>,
}

// ── Tool definitions ─────────────────────────────────────────────────────────

/// Ticket management tools — always available regardless of repo configuration
pub fn ticket_tool_definitions() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "name": "propose_tickets",
            "description": "Propose new tickets for the user to review and approve. The user will see an interactive card with the proposal and can accept, edit, or dismiss it. You MUST use this tool (not inline JSON) whenever you want to create tickets.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "tickets": {
                        "type": "array",
                        "description": "Array of ticket objects to propose",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string", "description": "Concise ticket title, under 80 characters" },
                                "description": { "type": "string", "description": "Structured description with ## What and ## Implementation Notes sections" },
                                "status": { "type": "string", "description": "Ticket status, usually 'todo'" },
                                "files_affected": { "type": "array", "items": { "type": "string" }, "description": "File paths that need modification" },
                                "acceptance_criteria": { "type": "array", "items": { "type": "string" }, "description": "Testable conditions that define done" },
                                "subtasks": { "type": "array", "items": { "type": "object" }, "description": "Optional child tickets with the same structure" }
                            },
                            "required": ["title", "description", "status", "files_affected", "acceptance_criteria"]
                        }
                    }
                },
                "required": ["tickets"]
            }
        }),
        serde_json::json!({
            "name": "modify_tickets",
            "description": "Propose modifications to existing tickets. The user will see a confirmation card before changes are applied.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "modifications": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "task_id": { "type": "string", "description": "The ID of the task to modify (from Current Tasks list)" },
                                "title": { "type": "string" },
                                "description": { "type": "string" },
                                "status": { "type": "string" }
                            },
                            "required": ["task_id"]
                        }
                    }
                },
                "required": ["modifications"]
            }
        }),
        serde_json::json!({
            "name": "delete_tickets",
            "description": "Propose deletion of existing tickets. The user will see a confirmation card before deletions are applied.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "deletions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "task_id": { "type": "string", "description": "The ID of the task to delete" },
                                "title": { "type": "string", "description": "Task title for confirmation display" }
                            },
                            "required": ["task_id", "title"]
                        }
                    }
                },
                "required": ["deletions"]
            }
        }),
    ]
}

/// Codebase exploration tools — only available when project has repos configured
pub fn codebase_tool_definitions() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "name": "read_file",
            "description": "Read the contents of a file from one of the project's repositories. Returns the file text (capped at 100KB).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative path from repo root, e.g. src/main.rs" },
                    "repo_name": { "type": "string", "description": "Repository name. Omit if the project has only one repo." }
                },
                "required": ["path"]
            }
        }),
        serde_json::json!({
            "name": "search_files",
            "description": "Search for files whose path contains the query string. Returns up to 50 matching paths.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search term — file name, partial path, or extension (e.g. '.tsx')" },
                    "repo_name": { "type": "string", "description": "Repository name. Omit if the project has only one repo." }
                },
                "required": ["query"]
            }
        }),
        serde_json::json!({
            "name": "grep_codebase",
            "description": "Search file contents for a text pattern (case-insensitive substring match). Returns up to 30 matching lines with file paths and line numbers.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Text pattern to search for in file contents" },
                    "file_glob": { "type": "string", "description": "Optional glob to limit search, e.g. '*.rs' or 'src/**/*.ts'" },
                    "repo_name": { "type": "string", "description": "Repository name. Omit if the project has only one repo." }
                },
                "required": ["pattern"]
            }
        }),
        serde_json::json!({
            "name": "list_directory",
            "description": "List the contents of a directory in one of the project's repositories. Returns file and directory names.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative directory path from repo root. Use '.' or '' for root." },
                    "repo_name": { "type": "string", "description": "Repository name. Omit if the project has only one repo." }
                },
                "required": ["path"]
            }
        }),
        serde_json::json!({
            "name": "query_database",
            "description": "Execute a read-only SQL query against the project database. Only SELECT/WITH/EXPLAIN allowed. Max 500 rows returned.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sql": { "type": "string", "description": "The SQL query to execute" }
                },
                "required": ["sql"]
            }
        }),
    ]
}

/// All Anthropic-format tool definitions (ticket tools + codebase tools if repos available)
pub fn anthropic_tool_definitions(include_codebase: bool) -> Vec<serde_json::Value> {
    let mut tools = ticket_tool_definitions();
    if include_codebase {
        tools.extend(codebase_tool_definitions());
    }
    tools
}

pub fn openai_tool_definitions(include_codebase: bool) -> Vec<serde_json::Value> {
    anthropic_tool_definitions(include_codebase)
        .into_iter()
        .map(|tool| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool["description"],
                    "parameters": tool["input_schema"]
                }
            })
        })
        .collect()
}

// ── Repo path resolution ─────────────────────────────────────────────────────

pub async fn get_project_repos(
    pool: &SqlitePool,
    project_id: Uuid,
) -> Result<Vec<RepoInfo>, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT r.name, r.path FROM repos r
         JOIN project_repos pr ON pr.repo_id = r.id
         WHERE pr.project_id = ?",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(name, path)| RepoInfo {
            name,
            path: PathBuf::from(path),
        })
        .collect())
}

fn resolve_repo<'a>(repos: &'a [RepoInfo], repo_name: Option<&str>) -> Result<&'a RepoInfo, String> {
    match repo_name {
        Some(name) => repos
            .iter()
            .find(|r| r.name == name)
            .ok_or_else(|| format!("Repository '{name}' not found. Available: {}", repos.iter().map(|r| r.name.as_str()).collect::<Vec<_>>().join(", "))),
        None if repos.len() == 1 => Ok(&repos[0]),
        None if repos.is_empty() => Err("No repositories linked to this project.".to_string()),
        None => Err(format!(
            "Multiple repos linked — specify repo_name. Available: {}",
            repos.iter().map(|r| r.name.as_str()).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn resolve_scoped_path(repo: &RepoInfo, relative: &str) -> Result<PathBuf, String> {
    let cleaned = relative.replace('\\', "/");
    let cleaned = cleaned.trim_start_matches('/');

    // Reject obvious traversals before hitting the filesystem
    if cleaned.contains("..") {
        return Err("Path traversal blocked: '..' is not allowed.".to_string());
    }

    let full = repo.path.join(cleaned);

    // canonicalize may fail if path doesn't exist
    let canonical = full
        .canonicalize()
        .map_err(|_| format!("Path not found: {cleaned}"))?;

    let repo_canonical = repo
        .path
        .canonicalize()
        .map_err(|e| format!("Repo path error: {e}"))?;

    if !canonical.starts_with(&repo_canonical) {
        return Err("Path traversal blocked: path escapes repo directory.".to_string());
    }

    Ok(canonical)
}

// ── Tool execution ───────────────────────────────────────────────────────────

pub async fn execute_tool(
    pool: &SqlitePool,
    repos: &[RepoInfo],
    tool_call: &ToolCall,
) -> ToolResult {
    let input = &tool_call.input;
    let repo_name = input.get("repo_name").and_then(|v| v.as_str());

    // Proposal tools: pass input through as SSE events, don't execute server-side
    match tool_call.name.as_str() {
        "propose_tickets" => {
            return ToolResult {
                tool_call_id: tool_call.id.clone(),
                content: "Proposal shown to user for review.".to_string(),
                status_line: "Proposing tickets...".to_string(),
                sse_event: Some(serde_json::json!({
                    "type": "proposal",
                    "data": { "tickets": input.get("tickets").cloned().unwrap_or(serde_json::json!([])) }
                })),
            };
        }
        "modify_tickets" => {
            return ToolResult {
                tool_call_id: tool_call.id.clone(),
                content: "Modification proposal shown to user for review.".to_string(),
                status_line: "Proposing modifications...".to_string(),
                sse_event: Some(serde_json::json!({
                    "type": "modify_proposal",
                    "data": { "modifications": input.get("modifications").cloned().unwrap_or(serde_json::json!([])) }
                })),
            };
        }
        "delete_tickets" => {
            return ToolResult {
                tool_call_id: tool_call.id.clone(),
                content: "Deletion proposal shown to user for review.".to_string(),
                status_line: "Proposing deletions...".to_string(),
                sse_event: Some(serde_json::json!({
                    "type": "delete_proposal",
                    "data": { "deletions": input.get("deletions").cloned().unwrap_or(serde_json::json!([])) }
                })),
            };
        }
        _ => {}
    }

    let (content, status_line) = match tool_call.name.as_str() {
        "read_file" => exec_read_file(repos, input, repo_name),
        "search_files" => exec_search_files(repos, input, repo_name).await,
        "grep_codebase" => exec_grep_codebase(repos, input, repo_name).await,
        "list_directory" => exec_list_directory(repos, input, repo_name).await,
        "query_database" => exec_query_database(pool, input).await,
        other => (format!("Unknown tool: {other}"), format!("Unknown tool: {other}")),
    };

    ToolResult {
        tool_call_id: tool_call.id.clone(),
        content,
        status_line,
        sse_event: None,
    }
}

fn exec_read_file(
    repos: &[RepoInfo],
    input: &serde_json::Value,
    repo_name: Option<&str>,
) -> (String, String) {
    let path = input
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let status = format!("Reading {path}...");

    let repo = match resolve_repo(repos, repo_name) {
        Ok(r) => r,
        Err(e) => return (e, status),
    };

    let full_path = match resolve_scoped_path(repo, path) {
        Ok(p) => p,
        Err(e) => return (e, status),
    };

    // Check for binary content
    match std::fs::read(&full_path) {
        Ok(bytes) => {
            // Detect binary: check first 8KB for null bytes
            let check_len = bytes.len().min(8192);
            if bytes[..check_len].contains(&0) {
                return (
                    format!("[binary file, {} bytes]", bytes.len()),
                    status,
                );
            }
            let text = String::from_utf8_lossy(&bytes);
            const MAX_SIZE: usize = 100 * 1024;
            if text.len() > MAX_SIZE {
                let truncated = &text[..MAX_SIZE];
                (
                    format!("{truncated}\n\n[truncated at 100KB — file is {} bytes total]", bytes.len()),
                    status,
                )
            } else {
                (text.into_owned(), status)
            }
        }
        Err(e) => (format!("Error reading file: {e}"), status),
    }
}

async fn exec_search_files(
    repos: &[RepoInfo],
    input: &serde_json::Value,
    repo_name: Option<&str>,
) -> (String, String) {
    let query = input
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let status = format!("Searching for {query}...");

    let repo = match resolve_repo(repos, repo_name) {
        Ok(r) => r,
        Err(e) => return (e, status),
    };

    let repo_path = match repo.path.canonicalize() {
        Ok(p) => p,
        Err(e) => return (format!("Repo path error: {e}"), status),
    };

    let query_lower = query.to_lowercase();
    let mut matches = Vec::new();

    fn walk_dir(dir: &Path, repo_root: &Path, query: &str, results: &mut Vec<String>, max: usize) {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            if results.len() >= max {
                return;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden dirs and common noisy directories
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" || name == "dist" || name == "build" {
                continue;
            }

            if let Ok(rel) = path.strip_prefix(repo_root) {
                let rel_str = rel.to_string_lossy().to_string().replace('\\', "/");
                if rel_str.to_lowercase().contains(query) {
                    let suffix = if path.is_dir() { "/" } else { "" };
                    results.push(format!("{rel_str}{suffix}"));
                }
            }

            if path.is_dir() {
                walk_dir(&path, repo_root, query, results, max);
            }
        }
    }

    walk_dir(&repo_path, &repo_path, &query_lower, &mut matches, 50);
    matches.sort();

    if matches.is_empty() {
        (format!("No files found matching '{query}'."), status)
    } else {
        (matches.join("\n"), status)
    }
}

async fn exec_grep_codebase(
    repos: &[RepoInfo],
    input: &serde_json::Value,
    repo_name: Option<&str>,
) -> (String, String) {
    let pattern = input
        .get("pattern")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let file_glob = input.get("file_glob").and_then(|v| v.as_str());

    let status = format!("Searching for \"{pattern}\"...");

    let repo = match resolve_repo(repos, repo_name) {
        Ok(r) => r,
        Err(e) => return (e, status),
    };

    let repo_path = match repo.path.canonicalize() {
        Ok(p) => p,
        Err(e) => return (format!("Repo path error: {e}"), status),
    };

    let pattern_lower = pattern.to_lowercase();
    let mut results: Vec<String> = Vec::new();
    let max_results = 30;

    fn grep_walk(
        dir: &Path,
        repo_root: &Path,
        pattern: &str,
        file_glob: Option<&str>,
        results: &mut Vec<String>,
        max: usize,
    ) {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            if results.len() >= max {
                return;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if name.starts_with('.')
                || name == "node_modules"
                || name == "target"
                || name == "__pycache__"
                || name == "dist"
                || name == "build"
            {
                continue;
            }

            if path.is_dir() {
                grep_walk(&path, repo_root, pattern, file_glob, results, max);
            } else if path.is_file() {
                // Apply file glob filter if provided
                if let Some(glob) = file_glob {
                    let file_name = name.to_lowercase();
                    let glob_lower = glob.to_lowercase().replace("*.", ".");
                    if !file_name.ends_with(&glob_lower) {
                        continue;
                    }
                }

                // Skip binary/large files
                let meta = match std::fs::metadata(&path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.len() > 512 * 1024 {
                    continue; // skip files > 512KB
                }

                let content = match std::fs::read_to_string(&path) {
                    Ok(c) => c,
                    Err(_) => continue, // skip binary/unreadable
                };

                let rel = path
                    .strip_prefix(repo_root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");

                for (line_num, line) in content.lines().enumerate() {
                    if results.len() >= max {
                        return;
                    }
                    if line.to_lowercase().contains(pattern) {
                        results.push(format!("{}:{}: {}", rel, line_num + 1, line.trim()));
                    }
                }
            }
        }
    }

    grep_walk(
        &repo_path,
        &repo_path,
        &pattern_lower,
        file_glob,
        &mut results,
        max_results,
    );

    if results.is_empty() {
        (
            format!("No matches found for '{pattern}'."),
            status,
        )
    } else {
        (results.join("\n"), status)
    }
}

async fn exec_list_directory(
    repos: &[RepoInfo],
    input: &serde_json::Value,
    repo_name: Option<&str>,
) -> (String, String) {
    let path = input
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or(".");

    let display_path = if path.is_empty() || path == "." {
        "root"
    } else {
        path
    };
    let status = format!("Listing {display_path}/...");

    let repo = match resolve_repo(repos, repo_name) {
        Ok(r) => r,
        Err(e) => return (e, status),
    };

    let dir_path = if path.is_empty() || path == "." {
        match repo.path.canonicalize() {
            Ok(p) => p,
            Err(e) => return (format!("Repo path error: {e}"), status),
        }
    } else {
        match resolve_scoped_path(repo, path) {
            Ok(p) => p,
            Err(e) => return (e, status),
        }
    };

    let entries = match std::fs::read_dir(&dir_path) {
        Ok(e) => e,
        Err(e) => return (format!("Error reading directory: {e}"), status),
    };

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if entry.path().is_dir() {
            dirs.push(format!("{name}/"));
        } else {
            files.push(name);
        }
    }

    dirs.sort();
    files.sort();

    let mut output = dirs;
    output.extend(files);

    if output.is_empty() {
        ("(empty directory)".to_string(), status)
    } else {
        (output.join("\n"), status)
    }
}

async fn exec_query_database(
    pool: &SqlitePool,
    input: &serde_json::Value,
) -> (String, String) {
    let sql = input
        .get("sql")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let status = "Querying database...".to_string();

    let trimmed = sql.trim();
    let first_word = trimmed
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_uppercase();

    if first_word != "SELECT" && first_word != "WITH" && first_word != "EXPLAIN" {
        return (
            "Only SELECT, WITH, and EXPLAIN queries are allowed.".to_string(),
            status,
        );
    }

    let upper = trimmed.to_uppercase();
    for forbidden in &[
        "INSERT ", "UPDATE ", "DELETE ", "DROP ", "ALTER ", "CREATE ", "REPLACE ", "ATTACH ",
        "DETACH ", "PRAGMA ", "VACUUM", "REINDEX",
    ] {
        for stmt in upper.split(';') {
            if stmt.trim().starts_with(forbidden.trim()) {
                return (
                    format!("Query contains forbidden keyword: {}.", forbidden.trim()),
                    status,
                );
            }
        }
    }

    let limited_sql = if upper.contains("LIMIT") {
        trimmed.to_string()
    } else {
        format!("{} LIMIT 500", trimmed.trim_end_matches(';'))
    };

    let rows = match sqlx::query(&limited_sql).fetch_all(pool).await {
        Ok(r) => r,
        Err(e) => return (format!("Query error: {e}"), status),
    };

    if rows.is_empty() {
        return ("(no rows returned)".to_string(), status);
    }

    let columns: Vec<String> = rows[0]
        .columns()
        .iter()
        .map(|c| c.name().to_string())
        .collect();

    let mut output = columns.join(" | ");
    output.push('\n');
    output.push_str(&columns.iter().map(|c| "-".repeat(c.len())).collect::<Vec<_>>().join("-+-"));
    output.push('\n');

    for row in &rows {
        let vals: Vec<String> = (0..columns.len())
            .map(|i| {
                if let Ok(Some(v)) = row.try_get::<Option<String>, _>(i) {
                    v
                } else if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(i) {
                    v.to_string()
                } else if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(i) {
                    v.to_string()
                } else if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(i) {
                    v.to_string()
                } else {
                    "NULL".to_string()
                }
            })
            .collect();
        output.push_str(&vals.join(" | "));
        output.push('\n');
    }

    output.push_str(&format!("\n({} rows)", rows.len()));

    (output, status)
}

// ── Response parsing helpers ─────────────────────────────────────────────────

/// Extract tool calls from a non-streaming API response.
pub fn extract_tool_calls(response: &serde_json::Value, is_openai: bool) -> Vec<ToolCall> {
    if is_openai {
        // OpenAI: choices[0].message.tool_calls[]
        response
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("tool_calls"))
            .and_then(|tc| tc.as_array())
            .map(|calls| {
                calls
                    .iter()
                    .filter_map(|call| {
                        let id = call.get("id")?.as_str()?.to_string();
                        let func = call.get("function")?;
                        let name = func.get("name")?.as_str()?.to_string();
                        let args_str = func.get("arguments")?.as_str()?;
                        let input = serde_json::from_str(args_str).unwrap_or(serde_json::json!({}));
                        Some(ToolCall { id, name, input })
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        // Anthropic: content[] where type == "tool_use"
        response
            .get("content")
            .and_then(|c| c.as_array())
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|block| {
                        if block.get("type")?.as_str()? != "tool_use" {
                            return None;
                        }
                        let id = block.get("id")?.as_str()?.to_string();
                        let name = block.get("name")?.as_str()?.to_string();
                        let input = block.get("input")?.clone();
                        Some(ToolCall { id, name, input })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// Extract the final text content from a non-streaming response.
pub fn extract_text_content(response: &serde_json::Value, is_openai: bool) -> String {
    if is_openai {
        response
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        // Anthropic: concatenate all text blocks in content[]
        response
            .get("content")
            .and_then(|c| c.as_array())
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|b| {
                        if b.get("type")?.as_str()? == "text" {
                            Some(b.get("text")?.as_str()?.to_string())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default()
    }
}

/// Format the assistant's tool-call response as a message to append back to the conversation.
pub fn format_assistant_tool_message(
    response: &serde_json::Value,
    is_openai: bool,
) -> serde_json::Value {
    if is_openai {
        // OpenAI: pass through the full message object
        response
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .cloned()
            .unwrap_or(serde_json::json!({"role": "assistant", "content": ""}))
    } else {
        // Anthropic: use the full response as the assistant message
        serde_json::json!({
            "role": "assistant",
            "content": response.get("content").cloned().unwrap_or(serde_json::json!([]))
        })
    }
}

/// Format a tool result as a message to append to the conversation.
pub fn format_tool_result_message(
    result: &ToolResult,
    is_openai: bool,
) -> serde_json::Value {
    if is_openai {
        serde_json::json!({
            "role": "tool",
            "tool_call_id": result.tool_call_id,
            "content": result.content,
        })
    } else {
        serde_json::json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": result.tool_call_id,
                "content": result.content,
            }]
        })
    }
}

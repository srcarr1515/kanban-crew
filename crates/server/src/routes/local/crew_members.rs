use axum::{
    Router,
    extract::{Json, Path, State},
    response::Json as ResponseJson,
    routing::{delete, get, post, put},
};
use db::models::crew_member::CrewMember;
use deployment::Deployment;
use serde::Deserialize;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

/// MCP permission flag for vision tools (describe_image).
const MCP_VISION_PERMISSION: &str = "mcp.vision";

/// Returns true if the role name suggests QA, UX, design, or testing work —
/// these roles get `mcp.vision` enabled by default.
fn role_has_default_vision(role: &str) -> bool {
    let lower = role.to_ascii_lowercase();
    lower.contains("qa")
        || lower.contains("quality")
        || lower.contains("test")
        || lower.contains("ux")
        || lower.contains("design")
        || lower.contains("ui")
        || lower.contains("visual")
        || lower.contains("review")
}

// ── Request types ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateCrewMemberRequest {
    pub name: String,
    pub role: String,
    pub avatar: Option<String>,
    pub role_prompt: Option<String>,
    pub tool_access: Option<serde_json::Value>,
    pub personality: Option<String>,
    pub ai_provider: Option<String>,
    pub ai_model: Option<String>,
    /// Skill configuration. `null`/absent = all defaults, `[]` = none, `["x"]` = only those.
    pub skills: Option<serde_json::Value>,
    pub can_create_workspace: Option<bool>,
    pub can_merge_workspace: Option<bool>,
    pub can_propose_tasks: Option<bool>,
    pub can_query_database: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCrewMemberRequest {
    pub name: Option<String>,
    pub role: Option<String>,
    pub avatar: Option<String>,
    pub role_prompt: Option<String>,
    pub tool_access: Option<serde_json::Value>,
    pub personality: Option<String>,
    /// AI provider override. Send `""` to clear back to global default.
    pub ai_provider: Option<String>,
    /// AI model override. Send `""` to clear back to global default.
    pub ai_model: Option<String>,
    /// Skill configuration. Absent = keep existing, `null` = reset to all defaults,
    /// `[]` = no skills, `["x"]` = only those.
    pub skills: Option<serde_json::Value>,
    pub can_create_workspace: Option<bool>,
    pub can_merge_workspace: Option<bool>,
    pub can_propose_tasks: Option<bool>,
    pub can_query_database: Option<bool>,
}

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/local/crew-members", get(list_crew_members))
        .route("/local/crew-members", post(create_crew_member))
        .route("/local/crew-members/{id}", put(update_crew_member))
        .route("/local/crew-members/{id}", delete(delete_crew_member))
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async fn list_crew_members(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<CrewMember>>>, ApiError> {
    let pool = &deployment.db().pool;

    let members = sqlx::query_as::<_, CrewMember>(
        "SELECT id, name, role, avatar, role_prompt, tool_access, personality, ai_provider, ai_model, skills, can_create_workspace, can_merge_workspace, can_propose_tasks, can_query_database, created_at, updated_at
         FROM crew_members
         ORDER BY created_at ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(members)))
}

async fn create_crew_member(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateCrewMemberRequest>,
) -> Result<ResponseJson<ApiResponse<CrewMember>>, ApiError> {
    let pool = &deployment.db().pool;
    let id = Uuid::new_v4();
    let avatar = request.avatar.unwrap_or_else(|| {
        request
            .name
            .chars()
            .next()
            .unwrap_or('?')
            .to_uppercase()
            .to_string()
    });
    let role_prompt = request.role_prompt.unwrap_or_default();
    let tool_access = request
        .tool_access
        .map(|v| v.to_string())
        .unwrap_or_else(|| {
            // When tool_access is not explicitly provided, set role-based
            // defaults: QA / UX / design / tester roles get mcp.vision enabled.
            if role_has_default_vision(&request.role) {
                serde_json::json!([MCP_VISION_PERMISSION]).to_string()
            } else {
                "[]".to_string()
            }
        });
    let personality = request.personality.unwrap_or_default();
    let ai_provider = request.ai_provider.filter(|s| !s.is_empty());
    let ai_model = request.ai_model.filter(|s| !s.is_empty());
    // null or absent → DB NULL (all defaults); array → store as JSON string
    let skills = request
        .skills
        .filter(|v| !v.is_null())
        .map(|v| v.to_string());
    let can_create_workspace = request.can_create_workspace.unwrap_or(true);
    let can_merge_workspace = request.can_merge_workspace.unwrap_or(true);
    let can_propose_tasks = request.can_propose_tasks.unwrap_or(true);
    let can_query_database = request.can_query_database.unwrap_or(true);

    let member = sqlx::query_as::<_, CrewMember>(
        r#"INSERT INTO crew_members (id, name, role, avatar, role_prompt, tool_access, personality, ai_provider, ai_model, skills, can_create_workspace, can_merge_workspace, can_propose_tasks, can_query_database)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id, name, role, avatar, role_prompt, tool_access, personality, ai_provider, ai_model, skills, can_create_workspace, can_merge_workspace, can_propose_tasks, can_query_database, created_at, updated_at"#,
    )
    .bind(id)
    .bind(&request.name)
    .bind(&request.role)
    .bind(&avatar)
    .bind(&role_prompt)
    .bind(&tool_access)
    .bind(&personality)
    .bind(&ai_provider)
    .bind(&ai_model)
    .bind(&skills)
    .bind(can_create_workspace)
    .bind(can_merge_workspace)
    .bind(can_propose_tasks)
    .bind(can_query_database)
    .fetch_one(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(member)))
}

async fn update_crew_member(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateCrewMemberRequest>,
) -> Result<ResponseJson<ApiResponse<CrewMember>>, ApiError> {
    let pool = &deployment.db().pool;

    let tool_access_str = request.tool_access.map(|v| v.to_string());

    // For nullable override fields, distinguish "not sent" (None → keep) from
    // "sent as empty" (Some("") → clear to NULL) and "sent with value" (Some(v) → set).
    let ai_provider_update: Option<Option<&str>> = request
        .ai_provider
        .as_ref()
        .map(|s| if s.is_empty() { None } else { Some(s.as_str()) });
    let ai_model_update: Option<Option<&str>> = request
        .ai_model
        .as_ref()
        .map(|s| if s.is_empty() { None } else { Some(s.as_str()) });

    // For skills: absent (None) → keep, Some(null) → clear to DB NULL, Some(array) → set
    let skills_update: Option<Option<String>> = request.skills.map(|v| {
        if v.is_null() {
            None
        } else {
            Some(v.to_string())
        }
    });

    // Use CASE expressions for nullable fields so we can explicitly set NULL
    let member = sqlx::query_as::<_, CrewMember>(
        r#"UPDATE crew_members
           SET name        = COALESCE(?, name),
               role        = COALESCE(?, role),
               avatar      = COALESCE(?, avatar),
               role_prompt = COALESCE(?, role_prompt),
               tool_access = COALESCE(?, tool_access),
               personality = COALESCE(?, personality),
               ai_provider = CASE WHEN ? THEN ? ELSE ai_provider END,
               ai_model    = CASE WHEN ? THEN ? ELSE ai_model END,
               skills      = CASE WHEN ? THEN ? ELSE skills END,
               can_create_workspace = COALESCE(?, can_create_workspace),
               can_merge_workspace  = COALESCE(?, can_merge_workspace),
               can_propose_tasks    = COALESCE(?, can_propose_tasks),
               can_query_database   = COALESCE(?, can_query_database),
               updated_at  = datetime('now', 'subsec')
           WHERE id = ?
           RETURNING id, name, role, avatar, role_prompt, tool_access, personality, ai_provider, ai_model, skills, can_create_workspace, can_merge_workspace, can_propose_tasks, can_query_database, created_at, updated_at"#,
    )
    .bind(&request.name)
    .bind(&request.role)
    .bind(&request.avatar)
    .bind(&request.role_prompt)
    .bind(&tool_access_str)
    .bind(&request.personality)
    .bind(ai_provider_update.is_some())
    .bind(ai_provider_update.and_then(|v| v))
    .bind(ai_model_update.is_some())
    .bind(ai_model_update.and_then(|v| v))
    .bind(skills_update.is_some())
    .bind(skills_update.and_then(|v| v))
    .bind(request.can_create_workspace)
    .bind(request.can_merge_workspace)
    .bind(request.can_propose_tasks)
    .bind(request.can_query_database)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest(format!("Crew member {id} not found")))?;

    Ok(ResponseJson(ApiResponse::success(member)))
}

async fn delete_crew_member(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;

    sqlx::query("DELETE FROM crew_members WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

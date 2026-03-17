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

// ── Request types ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateCrewMemberRequest {
    pub name: String,
    pub role: String,
    pub avatar: Option<String>,
    pub role_prompt: Option<String>,
    pub tool_access: Option<serde_json::Value>,
    pub personality: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCrewMemberRequest {
    pub name: Option<String>,
    pub role: Option<String>,
    pub avatar: Option<String>,
    pub role_prompt: Option<String>,
    pub tool_access: Option<serde_json::Value>,
    pub personality: Option<String>,
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
        "SELECT id, name, role, avatar, role_prompt, tool_access, personality, created_at, updated_at
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
        .unwrap_or_else(|| "[]".to_string());
    let personality = request.personality.unwrap_or_default();

    let member = sqlx::query_as::<_, CrewMember>(
        r#"INSERT INTO crew_members (id, name, role, avatar, role_prompt, tool_access, personality)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           RETURNING id, name, role, avatar, role_prompt, tool_access, personality, created_at, updated_at"#,
    )
    .bind(id)
    .bind(&request.name)
    .bind(&request.role)
    .bind(&avatar)
    .bind(&role_prompt)
    .bind(&tool_access)
    .bind(&personality)
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

    let member = sqlx::query_as::<_, CrewMember>(
        r#"UPDATE crew_members
           SET name        = COALESCE(?, name),
               role        = COALESCE(?, role),
               avatar      = COALESCE(?, avatar),
               role_prompt = COALESCE(?, role_prompt),
               tool_access = COALESCE(?, tool_access),
               personality = COALESCE(?, personality),
               updated_at  = datetime('now', 'subsec')
           WHERE id = ?
           RETURNING id, name, role, avatar, role_prompt, tool_access, personality, created_at, updated_at"#,
    )
    .bind(&request.name)
    .bind(&request.role)
    .bind(&request.avatar)
    .bind(&request.role_prompt)
    .bind(&tool_access_str)
    .bind(&request.personality)
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

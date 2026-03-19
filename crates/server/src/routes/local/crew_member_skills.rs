use axum::{
    Router,
    extract::{Json, Path, State},
    response::Json as ResponseJson,
    routing::{delete, get, post, put},
};
use db::models::{crew_member_skill::CrewMemberSkill, skill::Skill};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

// ── Request types ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AddSkillRequest {
    pub skill_id: String,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSortOrderRequest {
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct ReplaceSkillsRequest {
    /// List of { skill_id, sort_order } to replace all current associations.
    pub skills: Vec<ReplaceSkillItem>,
}

#[derive(Debug, Deserialize)]
pub struct ReplaceSkillItem {
    pub skill_id: String,
    pub sort_order: Option<i64>,
}

// ── Response types ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
pub struct CrewMemberSkillEntry {
    pub crew_member_id: String,
    pub skill_id: String,
    pub sort_order: i64,
    pub skill: Option<Skill>,
}

// ── Router ──────────────────────────────────────────────────────────────────

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/local/crew-members/{crew_member_id}/skills",
            get(list_crew_member_skills),
        )
        .route(
            "/local/crew-members/{crew_member_id}/skills",
            post(add_crew_member_skill),
        )
        .route(
            "/local/crew-members/{crew_member_id}/skills",
            put(replace_crew_member_skills),
        )
        .route(
            "/local/crew-members/{crew_member_id}/skills/{skill_id}",
            put(update_crew_member_skill),
        )
        .route(
            "/local/crew-members/{crew_member_id}/skills/{skill_id}",
            delete(delete_crew_member_skill),
        )
}

// ── Handlers ────────────────────────────────────────────────────────────────

/// List all skills for a crew member, including full skill details.
async fn list_crew_member_skills(
    State(deployment): State<DeploymentImpl>,
    Path(crew_member_id): Path<String>,
) -> Result<ResponseJson<ApiResponse<Vec<Skill>>>, ApiError> {
    let pool = &deployment.db().pool;
    let skills =
        CrewMemberSkill::list_skills_for_crew_member(pool, &crew_member_id).await?;
    Ok(ResponseJson(ApiResponse::success(skills)))
}

/// Add a skill to a crew member.
async fn add_crew_member_skill(
    State(deployment): State<DeploymentImpl>,
    Path(crew_member_id): Path<String>,
    Json(request): Json<AddSkillRequest>,
) -> Result<ResponseJson<ApiResponse<CrewMemberSkill>>, ApiError> {
    let pool = &deployment.db().pool;
    let sort_order = request.sort_order.unwrap_or(0);
    let entry =
        CrewMemberSkill::create(pool, &crew_member_id, &request.skill_id, sort_order)
            .await?;
    Ok(ResponseJson(ApiResponse::success(entry)))
}

/// Replace all skill associations for a crew member (bulk set).
async fn replace_crew_member_skills(
    State(deployment): State<DeploymentImpl>,
    Path(crew_member_id): Path<String>,
    Json(request): Json<ReplaceSkillsRequest>,
) -> Result<ResponseJson<ApiResponse<Vec<CrewMemberSkill>>>, ApiError> {
    let pool = &deployment.db().pool;
    let skills: Vec<(String, i64)> = request
        .skills
        .into_iter()
        .enumerate()
        .map(|(i, item)| (item.skill_id, item.sort_order.unwrap_or(i as i64)))
        .collect();
    let entries = CrewMemberSkill::replace_all(pool, &crew_member_id, &skills).await?;
    Ok(ResponseJson(ApiResponse::success(entries)))
}

/// Update the sort_order for a specific crew member skill association.
async fn update_crew_member_skill(
    State(deployment): State<DeploymentImpl>,
    Path((crew_member_id, skill_id)): Path<(String, String)>,
    Json(request): Json<UpdateSortOrderRequest>,
) -> Result<ResponseJson<ApiResponse<CrewMemberSkill>>, ApiError> {
    let pool = &deployment.db().pool;
    let entry = CrewMemberSkill::update_sort_order(
        pool,
        &crew_member_id,
        &skill_id,
        request.sort_order,
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(entry)))
}

/// Remove a skill from a crew member.
async fn delete_crew_member_skill(
    State(deployment): State<DeploymentImpl>,
    Path((crew_member_id, skill_id)): Path<(String, String)>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;
    CrewMemberSkill::delete(pool, &crew_member_id, &skill_id).await?;
    Ok(ResponseJson(ApiResponse::success(())))
}

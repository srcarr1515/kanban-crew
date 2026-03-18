use std::sync::Arc;

use axum::{
    Extension, Router,
    extract::{Json, Path, State},
    response::Json as ResponseJson,
    routing::{delete, get, post, put},
};
use db::models::skill::Skill;
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError, skill_registry::SkillRegistry};

// ── Response types ──────────────────────────────────────────────────────────

/// Unified skill entry returned by the API. Merges disk and DB sources.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SkillEntry {
    /// Only present for database skills.
    pub id: Option<String>,
    pub name: String,
    pub description: String,
    pub trigger_description: String,
    pub content: String,
    /// "disk" for built-in defaults, "database" for user-created.
    pub source: String,
}

// ── Request types ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateSkillRequest {
    pub name: String,
    pub description: Option<String>,
    pub trigger_description: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSkillRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub trigger_description: Option<String>,
    pub content: Option<String>,
}

// ── Router ──────────────────────────────────────────────────────────────────

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/local/skills", get(list_skills))
        .route("/local/skills", post(create_skill))
        .route("/local/skills/{id}", get(get_skill))
        .route("/local/skills/{id}", put(update_skill))
        .route("/local/skills/{id}", delete(delete_skill))
}

// ── Handlers ────────────────────────────────────────────────────────────────

/// List all skills (merged view: disk defaults + DB user-created).
/// DB skills take precedence over disk skills when names collide.
async fn list_skills(
    State(deployment): State<DeploymentImpl>,
    Extension(registry): Extension<Arc<SkillRegistry>>,
) -> Result<ResponseJson<ApiResponse<Vec<SkillEntry>>>, ApiError> {
    let pool = &deployment.db().pool;
    let db_skills = Skill::list(pool).await?;

    // Collect DB skill names for collision detection
    let db_names: std::collections::HashSet<&str> =
        db_skills.iter().map(|s| s.name.as_str()).collect();

    let mut entries: Vec<SkillEntry> = Vec::new();

    // Add disk skills that aren't overridden by DB
    for disk in registry.disk_skills() {
        if !db_names.contains(disk.name.as_str()) {
            entries.push(SkillEntry {
                id: None,
                name: disk.name.clone(),
                description: disk.description.clone(),
                trigger_description: disk.trigger_description.clone(),
                content: disk.content.clone(),
                source: "disk".to_string(),
            });
        }
    }

    // Add all DB skills
    for skill in db_skills {
        entries.push(SkillEntry {
            id: Some(skill.id),
            name: skill.name,
            description: skill.description,
            trigger_description: skill.trigger_description,
            content: skill.content,
            source: "database".to_string(),
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(ResponseJson(ApiResponse::success(entries)))
}

/// Get a single skill by database ID.
async fn get_skill(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
) -> Result<ResponseJson<ApiResponse<Skill>>, ApiError> {
    let pool = &deployment.db().pool;
    let skill = Skill::get_by_id(pool, &id).await?;
    Ok(ResponseJson(ApiResponse::success(skill)))
}

/// Create a new user skill (stored in DB).
async fn create_skill(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateSkillRequest>,
) -> Result<ResponseJson<ApiResponse<Skill>>, ApiError> {
    let pool = &deployment.db().pool;

    if request.name.trim().is_empty() {
        return Err(ApiError::BadRequest("Skill name cannot be empty".into()));
    }

    let skill = Skill::create(
        pool,
        &request.name,
        &request.description.unwrap_or_default(),
        &request.trigger_description.unwrap_or_default(),
        &request.content.unwrap_or_default(),
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(skill)))
}

/// Update an existing user skill by ID.
async fn update_skill(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
    Json(request): Json<UpdateSkillRequest>,
) -> Result<ResponseJson<ApiResponse<Skill>>, ApiError> {
    let pool = &deployment.db().pool;

    // Fetch existing to fill in unchanged fields
    let existing = Skill::get_by_id(pool, &id).await?;

    let name = request.name.unwrap_or(existing.name);
    let description = request.description.unwrap_or(existing.description);
    let trigger_description = request
        .trigger_description
        .unwrap_or(existing.trigger_description);
    let content = request.content.unwrap_or(existing.content);

    if name.trim().is_empty() {
        return Err(ApiError::BadRequest("Skill name cannot be empty".into()));
    }

    let skill = Skill::update(
        pool,
        &id,
        &name,
        &description,
        &trigger_description,
        &content,
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(skill)))
}

/// Delete a user skill by ID.
async fn delete_skill(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;
    Skill::delete(pool, &id).await?;
    Ok(ResponseJson(ApiResponse::success(())))
}

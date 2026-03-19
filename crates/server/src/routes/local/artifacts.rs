use axum::{
    Router,
    extract::{Json, Path, Query, State},
    response::Json as ResponseJson,
    routing::{delete, get, post, put},
};
use db::models::artifact::Artifact;
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const VALID_ARTIFACT_TYPES: &[&str] = &[
    "spec",
    "test_plan",
    "bug_report",
    "design_notes",
    "review",
    "other",
];

// ── Request types ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, TS)]
pub struct CreateArtifactRequest {
    pub task_id: Uuid,
    pub crew_member_id: Option<String>,
    pub artifact_type: String,
    pub title: String,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, TS)]
pub struct UpdateArtifactRequest {
    pub crew_member_id: Option<Option<String>>,
    pub artifact_type: Option<String>,
    pub title: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListArtifactsQuery {
    pub task_id: Uuid,
}

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/local/artifacts", get(list_artifacts))
        .route("/local/artifacts", post(create_artifact))
        .route("/local/artifacts/{id}", get(get_artifact))
        .route("/local/artifacts/{id}", put(update_artifact))
        .route("/local/artifacts/{id}", delete(delete_artifact))
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async fn list_artifacts(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ListArtifactsQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<Artifact>>>, ApiError> {
    let pool = &deployment.db().pool;
    let artifacts = Artifact::list_by_task(pool, query.task_id).await?;
    Ok(ResponseJson(ApiResponse::success(artifacts)))
}

async fn get_artifact(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
) -> Result<ResponseJson<ApiResponse<Artifact>>, ApiError> {
    let pool = &deployment.db().pool;
    let artifact = Artifact::get_by_id(pool, &id).await?;
    Ok(ResponseJson(ApiResponse::success(artifact)))
}

async fn create_artifact(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateArtifactRequest>,
) -> Result<ResponseJson<ApiResponse<Artifact>>, ApiError> {
    let pool = &deployment.db().pool;

    if request.title.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Artifact title cannot be empty".into(),
        ));
    }
    if !VALID_ARTIFACT_TYPES.contains(&request.artifact_type.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid artifact_type '{}'. Must be one of: {}",
            request.artifact_type,
            VALID_ARTIFACT_TYPES.join(", ")
        )));
    }

    let artifact = Artifact::create(
        pool,
        request.task_id,
        request.crew_member_id.as_deref(),
        &request.artifact_type,
        &request.title,
        &request.content.unwrap_or_default(),
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(artifact)))
}

async fn update_artifact(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
    Json(request): Json<UpdateArtifactRequest>,
) -> Result<ResponseJson<ApiResponse<Artifact>>, ApiError> {
    let pool = &deployment.db().pool;

    let existing = Artifact::get_by_id(pool, &id).await?;

    let artifact_type = request.artifact_type.unwrap_or(existing.artifact_type);
    let title = request.title.unwrap_or(existing.title);
    let content = request.content.unwrap_or(existing.content);
    let crew_member_id = match request.crew_member_id {
        Some(v) => v,
        None => existing.crew_member_id,
    };

    if title.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Artifact title cannot be empty".into(),
        ));
    }
    if !VALID_ARTIFACT_TYPES.contains(&artifact_type.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid artifact_type '{}'. Must be one of: {}",
            artifact_type,
            VALID_ARTIFACT_TYPES.join(", ")
        )));
    }

    let artifact = Artifact::update(
        pool,
        &id,
        crew_member_id.as_deref(),
        &artifact_type,
        &title,
        &content,
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(artifact)))
}

async fn delete_artifact(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;
    Artifact::delete(pool, &id).await?;
    Ok(ResponseJson(ApiResponse::success(())))
}

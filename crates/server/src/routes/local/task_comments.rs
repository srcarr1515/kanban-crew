use axum::{
    Router,
    extract::{Json, Path, State},
    response::Json as ResponseJson,
    routing::get,
};
use db::models::task_comment::TaskComment;
use deployment::Deployment;
use serde::Deserialize;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

// ── Request types ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateCommentRequest {
    pub author_type: String,
    pub author_name: String,
    pub content: String,
}

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<DeploymentImpl> {
    Router::new().route(
        "/local/tasks/{task_id}/comments",
        get(list_comments).post(create_comment),
    )
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async fn list_comments(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<TaskComment>>>, ApiError> {
    let pool = &deployment.db().pool;
    let comments = TaskComment::list_by_task(pool, task_id).await?;
    Ok(ResponseJson(ApiResponse::success(comments)))
}

async fn create_comment(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
    Json(request): Json<CreateCommentRequest>,
) -> Result<ResponseJson<ApiResponse<TaskComment>>, ApiError> {
    let pool = &deployment.db().pool;
    let comment = TaskComment::create(
        pool,
        task_id,
        &request.author_type,
        &request.author_name,
        &request.content,
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(comment)))
}

use axum::{
    Router,
    extract::{Json, Path, Query, State},
    response::Json as ResponseJson,
    routing::{delete, get, patch, post},
};
use chrono::{DateTime, Utc};
use db::models::project::Project;
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

pub mod chat;

// ── Response types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LocalTask {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Request types ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ListTasksQuery {
    pub project_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub project_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub status: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct BulkUpdateItem {
    pub id: Uuid,
    pub status: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct BulkUpdateRequest {
    pub updates: Vec<BulkUpdateItem>,
}

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/local/projects", get(list_projects))
        .route("/local/projects", post(create_project))
        .route("/local/tasks", get(list_tasks))
        .route("/local/tasks", post(create_task))
        .route("/local/tasks/bulk-update", post(bulk_update_tasks))
        .route("/local/tasks/{id}", patch(update_task))
        .route("/local/tasks/{id}", delete(delete_task))
        .merge(chat::router())
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async fn list_projects(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Project>>>, ApiError> {
    let pool = &deployment.db().pool;
    let projects = Project::find_all(pool).await?;
    Ok(ResponseJson(ApiResponse::success(projects)))
}

async fn create_project(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateProjectRequest>,
) -> Result<ResponseJson<ApiResponse<Project>>, ApiError> {
    let pool = &deployment.db().pool;
    let id = Uuid::new_v4();

    let project = sqlx::query_as::<_, Project>(
        r#"INSERT INTO projects (id, name)
           VALUES (?, ?)
           RETURNING id, name, default_agent_working_dir, remote_project_id, created_at, updated_at"#,
    )
    .bind(id)
    .bind(&request.name)
    .fetch_one(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(project)))
}

async fn list_tasks(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ListTasksQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<LocalTask>>>, ApiError> {
    let pool = &deployment.db().pool;

    let tasks = sqlx::query_as::<_, LocalTask>(
        r#"SELECT id, project_id, title, description, status, sort_order, created_at, updated_at
           FROM tasks
           WHERE project_id = ?
           ORDER BY sort_order ASC, created_at ASC"#,
    )
    .bind(query.project_id)
    .fetch_all(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(tasks)))
}

async fn create_task(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateTaskRequest>,
) -> Result<ResponseJson<ApiResponse<LocalTask>>, ApiError> {
    let pool = &deployment.db().pool;
    let id = Uuid::new_v4();
    let status = request.status.unwrap_or_else(|| "todo".to_string());
    let sort_order = request.sort_order.unwrap_or(0);

    let task = sqlx::query_as::<_, LocalTask>(
        r#"INSERT INTO tasks (id, project_id, title, description, status, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)
           RETURNING id, project_id, title, description, status, sort_order, created_at, updated_at"#,
    )
    .bind(id)
    .bind(request.project_id)
    .bind(&request.title)
    .bind(&request.description)
    .bind(&status)
    .bind(sort_order)
    .fetch_one(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(task)))
}

async fn update_task(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateTaskRequest>,
) -> Result<ResponseJson<ApiResponse<LocalTask>>, ApiError> {
    let pool = &deployment.db().pool;

    // Build dynamic update — only update provided fields
    let task = sqlx::query_as::<_, LocalTask>(
        r#"UPDATE tasks
           SET title       = COALESCE(?, title),
               description = CASE WHEN ? THEN ? ELSE description END,
               status      = COALESCE(?, status),
               sort_order  = COALESCE(?, sort_order),
               updated_at  = datetime('now', 'subsec')
           WHERE id = ?
           RETURNING id, project_id, title, description, status, sort_order, created_at, updated_at"#,
    )
    .bind(&request.title)
    .bind(request.description.is_some())
    .bind(request.description.as_ref().and_then(|d| d.as_deref()))
    .bind(&request.status)
    .bind(request.sort_order)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest(format!("Task {id} not found")))?;

    Ok(ResponseJson(ApiResponse::success(task)))
}

async fn delete_task(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;

    sqlx::query("DELETE FROM tasks WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

async fn bulk_update_tasks(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<BulkUpdateRequest>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;

    for item in &request.updates {
        sqlx::query(
            r#"UPDATE tasks
               SET status     = COALESCE(?, status),
                   sort_order = COALESCE(?, sort_order),
                   updated_at = datetime('now', 'subsec')
               WHERE id = ?"#,
        )
        .bind(&item.status)
        .bind(item.sort_order)
        .bind(item.id)
        .execute(pool)
        .await?;
    }

    Ok(ResponseJson(ApiResponse::success(())))
}

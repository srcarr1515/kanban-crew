use axum::{
    Extension, Json, Router,
    extract::State,
    middleware::from_fn_with_state,
    response::Json as ResponseJson,
    routing::{get, post},
};
use db::models::{
    job::{CreateJob, Job, UpdateJob},
    job_run::{CreateJobRun, JobRun},
};
use deployment::Deployment;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError, middleware::load_job_middleware};

pub async fn list_jobs(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Job>>>, ApiError> {
    let jobs = Job::find_all(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success(jobs)))
}

pub async fn create_job(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateJob>,
) -> Result<ResponseJson<ApiResponse<Job>>, ApiError> {
    let job = Job::create(&deployment.db().pool, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(job)))
}

pub async fn get_job(
    Extension(job): Extension<Job>,
) -> Result<ResponseJson<ApiResponse<Job>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(job)))
}

pub async fn update_job(
    Extension(job): Extension<Job>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateJob>,
) -> Result<ResponseJson<ApiResponse<Job>>, ApiError> {
    let updated = Job::update(&deployment.db().pool, &job.id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn delete_job(
    Extension(job): Extension<Job>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Job>>, ApiError> {
    // Soft delete: set enabled = false
    let payload = UpdateJob {
        schedule_cron: None,
        enabled: Some(false),
    };
    let updated = Job::update(&deployment.db().pool, &job.id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn run_now(
    Extension(job): Extension<Job>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<JobRun>>, ApiError> {
    let run = JobRun::create(
        &deployment.db().pool,
        &CreateJobRun {
            job_id: job.id.clone(),
        },
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(run)))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let job_id_router = Router::new()
        .route("/", get(get_job).patch(update_job).delete(delete_job))
        .route("/run-now", post(run_now))
        .layer(from_fn_with_state(deployment.clone(), load_job_middleware));

    let inner = Router::new()
        .route("/", get(list_jobs).post(create_job))
        .nest("/{job_id}", job_id_router);

    Router::new().nest("/jobs", inner)
}

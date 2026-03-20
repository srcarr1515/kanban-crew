use axum::{
    Extension, Router,
    extract::{Query, State},
    middleware::from_fn_with_state,
    response::Json as ResponseJson,
    routing::{get, post},
};
use db::models::job_run::{JobRun, JobRunFilter, JobRunStatus};
use deployment::Deployment;
use serde::Deserialize;
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError, middleware::load_job_run_middleware};

#[derive(Debug, Deserialize, TS)]
pub struct JobRunQueryParams {
    #[serde(default)]
    pub job_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub from_date: Option<String>,
    #[serde(default)]
    pub to_date: Option<String>,
}

pub async fn list_job_runs(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<JobRunQueryParams>,
) -> Result<ResponseJson<ApiResponse<Vec<JobRun>>>, ApiError> {
    let filter = JobRunFilter {
        job_id: params.job_id,
        status: params.status,
        from_date: params.from_date,
        to_date: params.to_date,
    };
    let runs = JobRun::find_filtered(&deployment.db().pool, &filter).await?;
    Ok(ResponseJson(ApiResponse::success(runs)))
}

pub async fn retry_job_run(
    Extension(job_run): Extension<JobRun>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<JobRun>>, ApiError> {
    if job_run.status != JobRunStatus::Failed && job_run.status != JobRunStatus::Cancelled {
        return Err(ApiError::BadRequest(
            "Only failed or cancelled runs can be retried".to_string(),
        ));
    }
    let updated = JobRun::retry(&deployment.db().pool, &job_run.id).await?;
    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let run_id_router =
        Router::new()
            .route("/retry", post(retry_job_run))
            .layer(from_fn_with_state(
                deployment.clone(),
                load_job_run_middleware,
            ));

    let inner = Router::new()
        .route("/", get(list_job_runs))
        .nest("/{job_run_id}", run_id_router);

    Router::new().nest("/job-runs", inner)
}

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use strum_macros::{Display, EnumString};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS, EnumString, Display)]
#[sqlx(type_name = "job_run_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum JobRunStatus {
    Pending,
    Running,
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct JobRun {
    pub id: String,
    pub job_id: String,
    pub spawned_task_id: Option<Uuid>,
    pub status: JobRunStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub outcome_json: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateJobRun {
    pub job_id: String,
}

#[derive(Debug, Default)]
pub struct JobRunFilter {
    pub job_id: Option<String>,
    pub status: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

impl JobRun {
    pub async fn find_by_id(pool: &SqlitePool, id: &str) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, JobRun>(
            r#"SELECT id, job_id, spawned_task_id, status, started_at, finished_at, outcome_json, created_at
               FROM job_runs
               WHERE id = ?"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_job_id(pool: &SqlitePool, job_id: &str) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, JobRun>(
            r#"SELECT id, job_id, spawned_task_id, status, started_at, finished_at, outcome_json, created_at
               FROM job_runs
               WHERE job_id = ?
               ORDER BY created_at DESC"#,
        )
        .bind(job_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(pool: &SqlitePool, data: &CreateJobRun) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        let status = JobRunStatus::Pending.to_string();

        sqlx::query_as::<_, JobRun>(
            r#"INSERT INTO job_runs (id, job_id, status)
               VALUES (?, ?, ?)
               RETURNING id, job_id, spawned_task_id, status, started_at, finished_at, outcome_json, created_at"#,
        )
        .bind(&id)
        .bind(&data.job_id)
        .bind(&status)
        .fetch_one(pool)
        .await
    }

    pub async fn mark_running(
        pool: &SqlitePool,
        id: &str,
        spawned_task_id: Option<Uuid>,
    ) -> Result<Self, sqlx::Error> {
        let status = JobRunStatus::Running.to_string();

        sqlx::query_as::<_, JobRun>(
            r#"UPDATE job_runs
               SET status = ?, spawned_task_id = ?, started_at = datetime('now', 'subsec')
               WHERE id = ?
               RETURNING id, job_id, spawned_task_id, status, started_at, finished_at, outcome_json, created_at"#,
        )
        .bind(&status)
        .bind(spawned_task_id)
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn mark_finished(
        pool: &SqlitePool,
        id: &str,
        status: JobRunStatus,
        outcome_json: Option<&str>,
    ) -> Result<Self, sqlx::Error> {
        let status_str = status.to_string();

        sqlx::query_as::<_, JobRun>(
            r#"UPDATE job_runs
               SET status = ?, outcome_json = ?, finished_at = datetime('now', 'subsec')
               WHERE id = ?
               RETURNING id, job_id, spawned_task_id, status, started_at, finished_at, outcome_json, created_at"#,
        )
        .bind(&status_str)
        .bind(outcome_json)
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn find_filtered(
        pool: &SqlitePool,
        filter: &JobRunFilter,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, JobRun>(
            r#"SELECT id, job_id, spawned_task_id, status, started_at, finished_at, outcome_json, created_at
               FROM job_runs
               WHERE (? IS NULL OR job_id = ?)
               AND (? IS NULL OR status = ?)
               AND (? IS NULL OR created_at >= ?)
               AND (? IS NULL OR created_at <= ?)
               ORDER BY created_at DESC"#,
        )
        .bind(&filter.job_id)
        .bind(&filter.job_id)
        .bind(&filter.status)
        .bind(&filter.status)
        .bind(&filter.from_date)
        .bind(&filter.from_date)
        .bind(&filter.to_date)
        .bind(&filter.to_date)
        .fetch_all(pool)
        .await
    }

    pub async fn retry(pool: &SqlitePool, id: &str) -> Result<Self, sqlx::Error> {
        let status = JobRunStatus::Pending.to_string();

        sqlx::query_as::<_, JobRun>(
            r#"UPDATE job_runs
               SET status = ?, started_at = NULL, finished_at = NULL, outcome_json = NULL
               WHERE id = ?
               RETURNING id, job_id, spawned_task_id, status, started_at, finished_at, outcome_json, created_at"#,
        )
        .bind(&status)
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM job_runs WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn delete_by_job_id(pool: &SqlitePool, job_id: &str) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM job_runs WHERE job_id = ?")
            .bind(job_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;
    use crate::models::job::{CreateJob, Job};

    // ── Unit tests for JobRunStatus ─────────────────────────────────────

    #[test]
    fn status_display_round_trip() {
        for (variant, expected) in [
            (JobRunStatus::Pending, "pending"),
            (JobRunStatus::Running, "running"),
            (JobRunStatus::Success, "success"),
            (JobRunStatus::Failed, "failed"),
            (JobRunStatus::Cancelled, "cancelled"),
        ] {
            let display = variant.to_string();
            assert_eq!(display, expected);
            let parsed = JobRunStatus::from_str(&display).expect("parse back");
            assert_eq!(parsed, variant);
        }
    }

    #[test]
    fn status_from_str_rejects_unknown() {
        assert!(JobRunStatus::from_str("bogus").is_err());
    }

    // ── Integration tests (need DB) ─────────────────────────────────────

    /// Seed a project + task + job so we can create job runs.
    /// Returns (job, project_id) so tests can insert additional tasks.
    async fn seed_job(pool: &SqlitePool) -> (Job, Uuid) {
        let project_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();

        sqlx::query("INSERT INTO projects (id, name) VALUES (?, ?)")
            .bind(project_id)
            .bind("Test Project")
            .execute(pool)
            .await
            .expect("insert project");

        sqlx::query("INSERT INTO tasks (id, project_id, title, status) VALUES (?, ?, ?, 'todo')")
            .bind(task_id)
            .bind(project_id)
            .bind("Template Task")
            .execute(pool)
            .await
            .expect("insert task");

        let job = Job::create(
            pool,
            &CreateJob {
                template_task_id: task_id,
                schedule_cron: "0 0 9 * * *".into(),
                enabled: Some(true),
            },
        )
        .await
        .expect("create job");

        (job, project_id)
    }

    /// Insert a task into the database and return its id.
    async fn insert_task(pool: &SqlitePool, project_id: Uuid) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO tasks (id, project_id, title, status) VALUES (?, ?, ?, 'todo')")
            .bind(id)
            .bind(project_id)
            .bind("Spawned Task")
            .execute(pool)
            .await
            .expect("insert spawned task");
        id
    }

    #[tokio::test]
    async fn create_run_starts_pending() {
        let pool = crate::test_pool().await;
        let (job, _project_id) = seed_job(&pool).await;

        let run = JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("create run");

        assert_eq!(run.status, JobRunStatus::Pending);
        assert_eq!(run.job_id, job.id);
        assert!(run.spawned_task_id.is_none());
        assert!(run.started_at.is_none());
        assert!(run.finished_at.is_none());
    }

    #[tokio::test]
    async fn mark_running_sets_status_and_task_id() {
        let pool = crate::test_pool().await;
        let (job, project_id) = seed_job(&pool).await;
        let run = JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("create run");

        // spawned_task_id has a FK constraint to tasks, so insert a real task
        let task_id = insert_task(&pool, project_id).await;
        let updated = JobRun::mark_running(&pool, &run.id, Some(task_id))
            .await
            .expect("mark running");

        assert_eq!(updated.status, JobRunStatus::Running);
        assert_eq!(updated.spawned_task_id, Some(task_id));
        assert!(updated.started_at.is_some());
    }

    #[tokio::test]
    async fn mark_finished_success() {
        let pool = crate::test_pool().await;
        let (job, _project_id) = seed_job(&pool).await;
        let run = JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("create run");

        let finished = JobRun::mark_finished(&pool, &run.id, JobRunStatus::Success, None)
            .await
            .expect("mark finished");

        assert_eq!(finished.status, JobRunStatus::Success);
        assert!(finished.finished_at.is_some());
        assert!(finished.outcome_json.is_none());
    }

    #[tokio::test]
    async fn mark_finished_failed_with_outcome() {
        let pool = crate::test_pool().await;
        let (job, _project_id) = seed_job(&pool).await;
        let run = JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("create run");

        let outcome = r#"{"error":"template task not found"}"#;
        let finished = JobRun::mark_finished(&pool, &run.id, JobRunStatus::Failed, Some(outcome))
            .await
            .expect("mark finished");

        assert_eq!(finished.status, JobRunStatus::Failed);
        assert_eq!(finished.outcome_json.as_deref(), Some(outcome));
    }

    #[tokio::test]
    async fn retry_resets_to_pending() {
        let pool = crate::test_pool().await;
        let (job, _project_id) = seed_job(&pool).await;
        let run = JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("create run");

        // Advance to failed
        JobRun::mark_finished(
            &pool,
            &run.id,
            JobRunStatus::Failed,
            Some(r#"{"error":"oops"}"#),
        )
        .await
        .expect("mark finished");

        // Retry
        let retried = JobRun::retry(&pool, &run.id).await.expect("retry");
        assert_eq!(retried.status, JobRunStatus::Pending);
        assert!(retried.started_at.is_none());
        assert!(retried.finished_at.is_none());
        assert!(retried.outcome_json.is_none());
    }

    #[tokio::test]
    async fn find_by_job_id_returns_runs() {
        let pool = crate::test_pool().await;
        let (job, _project_id) = seed_job(&pool).await;

        JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("run 1");
        JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("run 2");

        let runs = JobRun::find_by_job_id(&pool, &job.id).await.expect("find");
        assert_eq!(runs.len(), 2);
    }

    #[tokio::test]
    async fn find_filtered_by_status() {
        let pool = crate::test_pool().await;
        let (job, _project_id) = seed_job(&pool).await;

        let run1 = JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("run 1");
        JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("run 2");

        JobRun::mark_finished(&pool, &run1.id, JobRunStatus::Success, None)
            .await
            .expect("finish run 1");

        let filter = JobRunFilter {
            status: Some("success".into()),
            ..Default::default()
        };
        let filtered = JobRun::find_filtered(&pool, &filter).await.expect("filter");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].status, JobRunStatus::Success);
    }

    #[tokio::test]
    async fn delete_run() {
        let pool = crate::test_pool().await;
        let (job, _project_id) = seed_job(&pool).await;

        let run = JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("create run");

        JobRun::delete(&pool, &run.id).await.expect("delete");

        let found = JobRun::find_by_id(&pool, &run.id).await.expect("find");
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn delete_by_job_id_removes_all_runs() {
        let pool = crate::test_pool().await;
        let (job, _project_id) = seed_job(&pool).await;

        JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("run 1");
        JobRun::create(
            &pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await
        .expect("run 2");

        let deleted = JobRun::delete_by_job_id(&pool, &job.id)
            .await
            .expect("delete by job");
        assert_eq!(deleted, 2);

        let runs = JobRun::find_by_job_id(&pool, &job.id).await.expect("find");
        assert!(runs.is_empty());
    }
}

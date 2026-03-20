use std::str::FromStr;

use chrono::{DateTime, Utc};
use cron::Schedule;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Job {
    pub id: String,
    pub template_task_id: Uuid,
    pub schedule_cron: String,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateJob {
    pub template_task_id: Uuid,
    pub schedule_cron: String,
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateJob {
    pub schedule_cron: Option<String>,
    pub enabled: Option<bool>,
}

/// Validates a cron expression. Returns `Ok(())` if valid, or an error message.
pub fn validate_cron(expr: &str) -> Result<(), String> {
    Schedule::from_str(expr)
        .map(|_| ())
        .map_err(|e| format!("invalid cron expression: {e}"))
}

impl Job {
    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Job>(
            r#"SELECT id, template_task_id, schedule_cron, enabled, created_at, updated_at
               FROM jobs
               ORDER BY created_at DESC"#,
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: &str) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Job>(
            r#"SELECT id, template_task_id, schedule_cron, enabled, created_at, updated_at
               FROM jobs
               WHERE id = ?"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_enabled(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Job>(
            r#"SELECT id, template_task_id, schedule_cron, enabled, created_at, updated_at
               FROM jobs
               WHERE enabled = 1
               ORDER BY created_at DESC"#,
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_template_task_id(
        pool: &SqlitePool,
        template_task_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Job>(
            r#"SELECT id, template_task_id, schedule_cron, enabled, created_at, updated_at
               FROM jobs
               WHERE template_task_id = ?
               ORDER BY created_at DESC"#,
        )
        .bind(template_task_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(pool: &SqlitePool, data: &CreateJob) -> Result<Self, sqlx::Error> {
        validate_cron(&data.schedule_cron).map_err(|e| sqlx::Error::Protocol(e))?;

        let id = Uuid::new_v4().to_string();
        let enabled = data.enabled.unwrap_or(true);

        sqlx::query_as::<_, Job>(
            r#"INSERT INTO jobs (id, template_task_id, schedule_cron, enabled)
               VALUES (?, ?, ?, ?)
               RETURNING id, template_task_id, schedule_cron, enabled, created_at, updated_at"#,
        )
        .bind(&id)
        .bind(data.template_task_id)
        .bind(&data.schedule_cron)
        .bind(enabled)
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: &str,
        data: &UpdateJob,
    ) -> Result<Self, sqlx::Error> {
        let existing = Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let schedule_cron = data
            .schedule_cron
            .as_deref()
            .unwrap_or(&existing.schedule_cron);
        let enabled = data.enabled.unwrap_or(existing.enabled);

        validate_cron(schedule_cron).map_err(|e| sqlx::Error::Protocol(e))?;

        sqlx::query_as::<_, Job>(
            r#"UPDATE jobs
               SET schedule_cron = ?, enabled = ?, updated_at = datetime('now', 'subsec')
               WHERE id = ?
               RETURNING id, template_task_id, schedule_cron, enabled, created_at, updated_at"#,
        )
        .bind(schedule_cron)
        .bind(enabled)
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM jobs WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The cron crate (0.15) uses 6- or 7-field format: sec min hour dom month dow [year]

    #[test]
    fn validate_cron_accepts_valid_6field() {
        assert!(validate_cron("0 0 9 * * *").is_ok());
        assert!(validate_cron("0 */5 * * * *").is_ok());
        assert!(validate_cron("0 0 0 1 * *").is_ok());
        assert!(validate_cron("0 30 14 * * 1").is_ok());
    }

    #[test]
    fn validate_cron_accepts_valid_7field() {
        assert!(validate_cron("0 30 9 1,15 May-Aug Mon,Fri 2025/2").is_ok());
    }

    #[test]
    fn validate_cron_rejects_empty() {
        assert!(validate_cron("").is_err());
    }

    #[test]
    fn validate_cron_rejects_garbage() {
        assert!(validate_cron("not a cron expression").is_err());
    }

    #[test]
    fn validate_cron_rejects_partial() {
        assert!(validate_cron("0 9").is_err());
    }

    // ── Integration tests (need DB) ──────────────────────────────────────

    /// Insert a project and a task so we can create jobs referencing them.
    async fn seed_template_task(pool: &SqlitePool) -> Uuid {
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

        task_id
    }

    #[tokio::test]
    async fn create_and_find_job() {
        let pool = crate::test_pool().await;
        let task_id = seed_template_task(&pool).await;

        let job = Job::create(
            &pool,
            &CreateJob {
                template_task_id: task_id,
                schedule_cron: "0 0 9 * * *".into(),
                enabled: Some(true),
            },
        )
        .await
        .expect("create job");

        assert_eq!(job.template_task_id, task_id);
        assert_eq!(job.schedule_cron, "0 0 9 * * *");
        assert!(job.enabled);

        let found = Job::find_by_id(&pool, &job.id)
            .await
            .expect("find job")
            .expect("job exists");
        assert_eq!(found.id, job.id);
    }

    #[tokio::test]
    async fn create_job_rejects_invalid_cron() {
        let pool = crate::test_pool().await;
        let task_id = seed_template_task(&pool).await;

        let result = Job::create(
            &pool,
            &CreateJob {
                template_task_id: task_id,
                schedule_cron: "bad cron".into(),
                enabled: None,
            },
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn create_job_defaults_enabled_to_true() {
        let pool = crate::test_pool().await;
        let task_id = seed_template_task(&pool).await;

        let job = Job::create(
            &pool,
            &CreateJob {
                template_task_id: task_id,
                schedule_cron: "0 0 9 * * *".into(),
                enabled: None,
            },
        )
        .await
        .expect("create job");

        assert!(job.enabled);
    }

    #[tokio::test]
    async fn find_enabled_filters_disabled() {
        let pool = crate::test_pool().await;
        let task_id = seed_template_task(&pool).await;

        Job::create(
            &pool,
            &CreateJob {
                template_task_id: task_id,
                schedule_cron: "0 0 9 * * *".into(),
                enabled: Some(true),
            },
        )
        .await
        .expect("create enabled job");

        Job::create(
            &pool,
            &CreateJob {
                template_task_id: task_id,
                schedule_cron: "0 0 12 * * *".into(),
                enabled: Some(false),
            },
        )
        .await
        .expect("create disabled job");

        let enabled = Job::find_enabled(&pool).await.expect("find enabled");
        assert_eq!(enabled.len(), 1);
        assert!(enabled[0].enabled);
    }

    #[tokio::test]
    async fn update_job_schedule() {
        let pool = crate::test_pool().await;
        let task_id = seed_template_task(&pool).await;

        let job = Job::create(
            &pool,
            &CreateJob {
                template_task_id: task_id,
                schedule_cron: "0 0 9 * * *".into(),
                enabled: Some(true),
            },
        )
        .await
        .expect("create job");

        let updated = Job::update(
            &pool,
            &job.id,
            &UpdateJob {
                schedule_cron: Some("0 0 12 * * *".into()),
                enabled: None,
            },
        )
        .await
        .expect("update job");

        assert_eq!(updated.schedule_cron, "0 0 12 * * *");
        assert!(updated.enabled);
    }

    #[tokio::test]
    async fn update_job_rejects_invalid_cron() {
        let pool = crate::test_pool().await;
        let task_id = seed_template_task(&pool).await;

        let job = Job::create(
            &pool,
            &CreateJob {
                template_task_id: task_id,
                schedule_cron: "0 0 9 * * *".into(),
                enabled: Some(true),
            },
        )
        .await
        .expect("create job");

        let result = Job::update(
            &pool,
            &job.id,
            &UpdateJob {
                schedule_cron: Some("invalid".into()),
                enabled: None,
            },
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn delete_job_removes_it() {
        let pool = crate::test_pool().await;
        let task_id = seed_template_task(&pool).await;

        let job = Job::create(
            &pool,
            &CreateJob {
                template_task_id: task_id,
                schedule_cron: "0 0 9 * * *".into(),
                enabled: Some(true),
            },
        )
        .await
        .expect("create job");

        Job::delete(&pool, &job.id).await.expect("delete job");

        let found = Job::find_by_id(&pool, &job.id).await.expect("query");
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn find_all_returns_all_jobs() {
        let pool = crate::test_pool().await;
        let task_id = seed_template_task(&pool).await;

        for _ in 0..3 {
            Job::create(
                &pool,
                &CreateJob {
                    template_task_id: task_id,
                    schedule_cron: "0 0 9 * * *".into(),
                    enabled: Some(true),
                },
            )
            .await
            .expect("create job");
        }

        let all = Job::find_all(&pool).await.expect("find all");
        assert_eq!(all.len(), 3);
    }

    #[tokio::test]
    async fn find_by_template_task_id_filters() {
        let pool = crate::test_pool().await;
        let task_id_a = seed_template_task(&pool).await;
        let task_id_b = seed_template_task(&pool).await;

        Job::create(
            &pool,
            &CreateJob {
                template_task_id: task_id_a,
                schedule_cron: "0 0 9 * * *".into(),
                enabled: Some(true),
            },
        )
        .await
        .expect("create job A");

        Job::create(
            &pool,
            &CreateJob {
                template_task_id: task_id_b,
                schedule_cron: "0 0 9 * * *".into(),
                enabled: Some(true),
            },
        )
        .await
        .expect("create job B");

        let jobs_a = Job::find_by_template_task_id(&pool, task_id_a)
            .await
            .expect("find by template");
        assert_eq!(jobs_a.len(), 1);
        assert_eq!(jobs_a[0].template_task_id, task_id_a);
    }
}

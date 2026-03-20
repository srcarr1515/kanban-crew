use std::{str::FromStr, time::Duration};

use chrono::Utc;
use cron::Schedule;
use db::{
    DBService,
    models::{
        job::Job,
        job_run::{CreateJobRun, JobRun, JobRunStatus},
    },
};
use sqlx::SqlitePool;
use tokio::time::interval;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Background service that evaluates cron schedules for enabled jobs,
/// spawns tasks from templates, and monitors job run completion.
pub struct JobSchedulerService {
    db: DBService,
    poll_interval: Duration,
}

impl JobSchedulerService {
    pub async fn spawn(db: DBService) -> tokio::task::JoinHandle<()> {
        let service = Self {
            db,
            poll_interval: Duration::from_secs(60),
        };
        tokio::spawn(async move {
            service.start().await;
        })
    }

    async fn start(&self) {
        info!(
            "Starting job scheduler service with interval {:?}",
            self.poll_interval
        );

        let mut interval = interval(self.poll_interval);

        loop {
            interval.tick().await;
            if let Err(e) = self.tick().await {
                error!("Job scheduler tick error: {}", e);
            }
        }
    }

    async fn tick(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.spawn_due_jobs().await?;
        self.check_running_jobs().await?;
        Ok(())
    }

    /// For each enabled job whose cron schedule fires within the last poll interval,
    /// create a job_run and clone the template task.
    async fn spawn_due_jobs(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool = &self.db.pool;
        let jobs = Job::find_enabled(pool).await?;

        if jobs.is_empty() {
            debug!("No enabled jobs to evaluate");
            return Ok(());
        }

        let now = Utc::now();
        let window_start = now - chrono::Duration::seconds(60);

        for job in &jobs {
            let schedule = match Schedule::from_str(&job.schedule_cron) {
                Ok(s) => s,
                Err(e) => {
                    warn!(
                        "Job {} has invalid cron '{}': {}",
                        job.id, job.schedule_cron, e
                    );
                    continue;
                }
            };

            // Check if any scheduled time falls within (window_start, now]
            let should_fire = schedule
                .after(&window_start)
                .next()
                .is_some_and(|t| t <= now);

            if !should_fire {
                continue;
            }

            info!(
                "Job {} is due, spawning task from template {}",
                job.id, job.template_task_id
            );

            if let Err(e) = self.spawn_job_run(pool, job).await {
                error!("Failed to spawn run for job {}: {}", job.id, e);
            }
        }

        Ok(())
    }

    /// Clone the template task and create a job_run.
    async fn spawn_job_run(
        &self,
        pool: &SqlitePool,
        job: &Job,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Create the job run in pending state
        let job_run = JobRun::create(
            pool,
            &CreateJobRun {
                job_id: job.id.clone(),
            },
        )
        .await?;

        // Clone the template task with a new id and status 'todo'
        let new_task_id = Uuid::new_v4();
        let result = sqlx::query(
            r#"INSERT INTO tasks (id, project_id, title, description, status, sort_order,
                                  parent_task_id, parent_task_sort_order, crew_member_id)
               SELECT ?, project_id, title, description, 'todo', sort_order,
                      parent_task_id, parent_task_sort_order, crew_member_id
               FROM tasks WHERE id = ?"#,
        )
        .bind(new_task_id)
        .bind(job.template_task_id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            // Template task not found, mark the run as failed
            JobRun::mark_finished(
                pool,
                &job_run.id,
                JobRunStatus::Failed,
                Some(r#"{"error":"template task not found"}"#),
            )
            .await?;
            warn!(
                "Template task {} not found for job {}",
                job.template_task_id, job.id
            );
            return Ok(());
        }

        // Mark the job run as running with the spawned task id
        JobRun::mark_running(pool, &job_run.id, Some(new_task_id)).await?;

        info!(
            "Job {} spawned task {} (run {})",
            job.id, new_task_id, job_run.id
        );

        Ok(())
    }

    /// Check running job_runs and update status based on spawned task status.
    async fn check_running_jobs(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool = &self.db.pool;

        // Find all running job_runs
        let running_runs: Vec<JobRun> = sqlx::query_as(
            r#"SELECT id, job_id, spawned_task_id, status, started_at, finished_at,
                      outcome_json, created_at
               FROM job_runs
               WHERE status = 'running'"#,
        )
        .fetch_all(pool)
        .await?;

        if running_runs.is_empty() {
            return Ok(());
        }

        debug!("Checking {} running job runs", running_runs.len());

        for run in &running_runs {
            let Some(task_id) = run.spawned_task_id else {
                continue;
            };

            // Get the spawned task's current status
            let task_status: Option<(String,)> =
                sqlx::query_as("SELECT status FROM tasks WHERE id = ?")
                    .bind(task_id)
                    .fetch_optional(pool)
                    .await?;

            let Some((status,)) = task_status else {
                // Task was deleted, mark run as failed
                JobRun::mark_finished(
                    pool,
                    &run.id,
                    JobRunStatus::Failed,
                    Some(r#"{"error":"spawned task was deleted"}"#),
                )
                .await?;
                continue;
            };

            match status.as_str() {
                "done" => {
                    info!("Job run {} completed (task {} done)", run.id, task_id);
                    JobRun::mark_finished(pool, &run.id, JobRunStatus::Success, None).await?;
                }
                "cancelled" => {
                    info!("Job run {} failed (task {} cancelled)", run.id, task_id);
                    JobRun::mark_finished(
                        pool,
                        &run.id,
                        JobRunStatus::Failed,
                        Some(r#"{"reason":"task cancelled"}"#),
                    )
                    .await?;
                }
                _ => {
                    // Still in progress (todo, ready, in_progress, in_review)
                }
            }
        }

        Ok(())
    }
}

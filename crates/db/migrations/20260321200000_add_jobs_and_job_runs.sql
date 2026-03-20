CREATE TABLE jobs (
    id                TEXT      PRIMARY KEY NOT NULL,
    template_task_id  BLOB      NOT NULL REFERENCES tasks(id),
    schedule_cron     TEXT      NOT NULL,
    enabled           INTEGER   NOT NULL DEFAULT 1,
    created_at        TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at        TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE TABLE job_runs (
    id              TEXT      PRIMARY KEY NOT NULL,
    job_id          TEXT      NOT NULL REFERENCES jobs(id),
    spawned_task_id BLOB               REFERENCES tasks(id),
    status          TEXT      NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
    started_at      TIMESTAMP,
    finished_at     TIMESTAMP,
    outcome_json    TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_jobs_template_enabled ON jobs(template_task_id, enabled);
CREATE INDEX idx_job_runs_job_status_created ON job_runs(job_id, status, created_at);

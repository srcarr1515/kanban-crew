CREATE TABLE artifacts (
    id              TEXT    PRIMARY KEY NOT NULL,
    task_id         BLOB    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    crew_member_id  TEXT             REFERENCES crew_members(id) ON DELETE SET NULL,
    artifact_type   TEXT    NOT NULL CHECK (artifact_type IN ('spec', 'test_plan', 'bug_report', 'design_notes', 'review', 'other')),
    title           TEXT    NOT NULL,
    content         TEXT    NOT NULL DEFAULT '',
    created_at      TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at      TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_artifacts_task ON artifacts(task_id);

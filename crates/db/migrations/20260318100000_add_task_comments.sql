CREATE TABLE task_comments (
    id          TEXT PRIMARY KEY NOT NULL,
    task_id     BLOB NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL CHECK (author_type IN ('user', 'agent')),
    author_name TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_task_comments_task ON task_comments(task_id);

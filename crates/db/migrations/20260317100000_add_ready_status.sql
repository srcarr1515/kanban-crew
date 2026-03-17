-- Add 'ready' status to the tasks CHECK constraint.
-- Positioned between 'todo' and 'in_progress' on the Kanban board.

-- Migrate any existing rows (none expected, but be safe)
-- SQLite requires table recreation to change CHECK constraints
COMMIT;

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE tasks_new (
    id                   BLOB PRIMARY KEY,
    project_id           BLOB NOT NULL,
    title                TEXT NOT NULL,
    description          TEXT,
    status               TEXT NOT NULL DEFAULT 'todo'
                           CHECK (status IN ('todo','ready','in_progress','done','cancelled','in_review')),
    created_at           TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    parent_workspace_id  BLOB,
    sort_order           INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO tasks_new (id, project_id, title, description, status, created_at, updated_at, parent_workspace_id, sort_order)
SELECT id, project_id, title, description, status, created_at, updated_at, parent_workspace_id, sort_order
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

-- Recreate indexes
CREATE INDEX idx_tasks_project_created_at ON tasks (project_id, created_at DESC);
CREATE INDEX idx_tasks_parent_workspace_id ON tasks (parent_workspace_id);

PRAGMA foreign_key_check;

COMMIT;

PRAGMA foreign_keys = ON;

-- sqlx workaround: start empty transaction for sqlx to close gracefully
BEGIN TRANSACTION;

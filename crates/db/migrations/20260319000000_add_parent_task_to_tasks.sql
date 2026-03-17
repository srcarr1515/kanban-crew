-- Add parent_task_id and parent_task_sort_order columns to tasks table
-- for sub-issue support in local mode.
ALTER TABLE tasks ADD COLUMN parent_task_id BLOB REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN parent_task_sort_order REAL;

CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id);

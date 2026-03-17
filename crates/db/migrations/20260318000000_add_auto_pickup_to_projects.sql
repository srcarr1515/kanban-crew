-- Add auto_pickup_enabled flag to projects table.
-- When enabled, the system will automatically pick up the next "ready" task
-- after an agent finishes its current task.
ALTER TABLE projects ADD COLUMN auto_pickup_enabled BOOLEAN NOT NULL DEFAULT 0;

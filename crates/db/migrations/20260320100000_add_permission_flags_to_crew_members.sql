-- Add permission flag columns to crew_members.
-- Default TRUE so existing members retain full access.
ALTER TABLE crew_members ADD COLUMN can_create_workspace BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE crew_members ADD COLUMN can_merge_workspace BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE crew_members ADD COLUMN can_propose_tasks BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE crew_members ADD COLUMN can_query_database BOOLEAN NOT NULL DEFAULT 1;

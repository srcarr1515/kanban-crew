-- Allow assigning a crew member to a task.
ALTER TABLE tasks ADD COLUMN crew_member_id TEXT DEFAULT NULL REFERENCES crew_members(id) ON DELETE SET NULL;

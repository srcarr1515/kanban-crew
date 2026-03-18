ALTER TABLE chat_threads ADD COLUMN crew_member_id BLOB REFERENCES crew_members(id) ON DELETE SET NULL;

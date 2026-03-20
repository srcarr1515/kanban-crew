ALTER TABLE projects ADD COLUMN default_repo_id BLOB REFERENCES repos(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN default_branch TEXT;

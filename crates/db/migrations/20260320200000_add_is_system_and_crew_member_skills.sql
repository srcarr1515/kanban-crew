-- Add is_system flag to skills table
ALTER TABLE skills ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT 0;

-- Junction table linking crew members to skills with ordering
CREATE TABLE crew_member_skills (
    crew_member_id TEXT NOT NULL,
    skill_id       TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (crew_member_id, skill_id),
    FOREIGN KEY (crew_member_id) REFERENCES crew_members(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id)       REFERENCES skills(id)       ON DELETE CASCADE
);

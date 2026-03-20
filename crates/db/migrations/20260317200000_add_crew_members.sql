CREATE TABLE crew_members (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT 'M',
    role_prompt TEXT NOT NULL DEFAULT '',
    tool_access TEXT NOT NULL DEFAULT '[]',
    personality TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec'))
);

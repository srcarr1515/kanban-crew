CREATE TABLE crew_members (
    id BLOB PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT 'M',
    role_prompt TEXT NOT NULL DEFAULT '',
    tool_access TEXT NOT NULL DEFAULT '[]',
    personality TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec'))
);

-- Seed default Manager crew member
INSERT INTO crew_members (id, name, role, avatar, role_prompt, tool_access, personality)
VALUES (
    X'00000000000000000000000000000001',
    'Manager',
    'manager',
    'M',
    'You are a project manager. Help coordinate tasks, assign work, and track progress.',
    '[]',
    'Professional, organized, and focused on delivering results.'
);

CREATE TABLE chat_threads (
    id TEXT PRIMARY KEY NOT NULL,
    project_id BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_id TEXT,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY NOT NULL,
    thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_chat_threads_project ON chat_threads(project_id);
CREATE INDEX idx_chat_messages_thread ON chat_messages(thread_id);

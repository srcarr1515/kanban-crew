CREATE TABLE skills (
    id                  TEXT PRIMARY KEY NOT NULL,
    name                TEXT NOT NULL UNIQUE,
    description         TEXT NOT NULL DEFAULT '',
    trigger_description TEXT NOT NULL DEFAULT '',
    content             TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at          TIMESTAMP NOT NULL DEFAULT (datetime('now', 'subsec'))
);

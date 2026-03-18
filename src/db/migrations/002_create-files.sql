CREATE TABLE IF NOT EXISTS files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    path            TEXT NOT NULL,
    language        TEXT NOT NULL,
    hash            TEXT NOT NULL,
    last_indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
    lines_of_code   INTEGER,
    UNIQUE(repo_id, path)
);

CREATE INDEX IF NOT EXISTS idx_files_repo_id ON files(repo_id);

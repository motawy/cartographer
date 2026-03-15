CREATE TABLE files (
    id              SERIAL PRIMARY KEY,
    repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    path            TEXT NOT NULL,
    language        VARCHAR(32) NOT NULL,
    hash            VARCHAR(64) NOT NULL,
    last_indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lines_of_code   INTEGER,
    UNIQUE(repo_id, path)
);

CREATE INDEX idx_files_repo_id ON files(repo_id);

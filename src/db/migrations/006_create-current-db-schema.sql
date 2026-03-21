CREATE TABLE IF NOT EXISTS db_current_tables (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id          INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    source_file_id   INTEGER REFERENCES files(id) ON DELETE SET NULL,
    name             TEXT NOT NULL,
    normalized_name  TEXT NOT NULL,
    line_start       INTEGER,
    line_end         INTEGER,
    UNIQUE(repo_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_db_current_tables_repo_id ON db_current_tables(repo_id);
CREATE INDEX IF NOT EXISTS idx_db_current_tables_normalized_name ON db_current_tables(normalized_name);

CREATE TABLE IF NOT EXISTS db_current_columns (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id          INTEGER NOT NULL REFERENCES db_current_tables(id) ON DELETE CASCADE,
    source_file_id    INTEGER REFERENCES files(id) ON DELETE SET NULL,
    name              TEXT NOT NULL,
    normalized_name   TEXT NOT NULL,
    data_type         TEXT,
    is_nullable       INTEGER NOT NULL DEFAULT 1,
    default_value     TEXT,
    ordinal_position  INTEGER NOT NULL,
    line_number       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_db_current_columns_table_id ON db_current_columns(table_id);
CREATE INDEX IF NOT EXISTS idx_db_current_columns_normalized_name ON db_current_columns(normalized_name);

CREATE TABLE IF NOT EXISTS db_current_foreign_keys (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id                INTEGER NOT NULL REFERENCES db_current_tables(id) ON DELETE CASCADE,
    source_file_id          INTEGER REFERENCES files(id) ON DELETE SET NULL,
    constraint_name         TEXT,
    source_columns_json     TEXT NOT NULL,
    target_table            TEXT NOT NULL,
    normalized_target_table TEXT NOT NULL,
    target_columns_json     TEXT NOT NULL,
    line_number             INTEGER
);

CREATE INDEX IF NOT EXISTS idx_db_current_foreign_keys_table_id ON db_current_foreign_keys(table_id);
CREATE INDEX IF NOT EXISTS idx_db_current_foreign_keys_target_table ON db_current_foreign_keys(normalized_target_table);

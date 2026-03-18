CREATE TABLE IF NOT EXISTS symbols (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id          INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL,
    name             TEXT NOT NULL,
    qualified_name   TEXT,
    visibility       TEXT,
    parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
    line_start       INTEGER NOT NULL,
    line_end         INTEGER NOT NULL,
    signature        TEXT,
    return_type      TEXT,
    docblock         TEXT,
    metadata         TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name ON symbols(qualified_name);
CREATE INDEX IF NOT EXISTS idx_symbols_qualified_lower ON symbols(qualified_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
CREATE INDEX IF NOT EXISTS idx_symbols_parent ON symbols(parent_symbol_id);

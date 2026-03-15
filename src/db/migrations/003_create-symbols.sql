CREATE TABLE symbols (
    id               SERIAL PRIMARY KEY,
    file_id          INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    kind             VARCHAR(32) NOT NULL,
    name             TEXT NOT NULL,
    qualified_name   TEXT,
    visibility       VARCHAR(16),
    parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
    line_start       INTEGER NOT NULL,
    line_end         INTEGER NOT NULL,
    signature        TEXT,
    return_type      TEXT,
    docblock         TEXT,
    metadata         JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_symbols_file_id ON symbols(file_id);
CREATE INDEX idx_symbols_qualified_name ON symbols(qualified_name);
CREATE INDEX idx_symbols_kind ON symbols(kind);
CREATE INDEX idx_symbols_parent ON symbols(parent_symbol_id);

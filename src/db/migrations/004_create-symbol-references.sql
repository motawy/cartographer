CREATE TABLE IF NOT EXISTS symbol_references (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    source_symbol_id      INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    target_qualified_name TEXT NOT NULL,
    target_symbol_id      INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
    reference_kind        TEXT,
    line_number           INTEGER
);

CREATE INDEX IF NOT EXISTS idx_refs_source ON symbol_references(source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_refs_target ON symbol_references(target_symbol_id);
CREATE INDEX IF NOT EXISTS idx_refs_target_name ON symbol_references(target_qualified_name);

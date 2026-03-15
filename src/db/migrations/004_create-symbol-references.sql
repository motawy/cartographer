-- Table created now, populated in Milestone 2 (dependency tracing)
CREATE TABLE symbol_references (
    id                    SERIAL PRIMARY KEY,
    source_symbol_id      INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    target_qualified_name TEXT NOT NULL,
    target_symbol_id      INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
    reference_kind        VARCHAR(32),
    line_number           INTEGER
);

CREATE INDEX idx_refs_source ON symbol_references(source_symbol_id);
CREATE INDEX idx_refs_target ON symbol_references(target_symbol_id);
CREATE INDEX idx_refs_target_name ON symbol_references(target_qualified_name);

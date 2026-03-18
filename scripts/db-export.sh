#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DB_PATH="${1:-$HOME/.cartograph/cartograph.db}"
OUTPUT="${2:-cartograph-export.sql}"

if [ ! -f "$DB_PATH" ]; then
  echo "Error: database not found at ${DB_PATH}"
  exit 1
fi

echo "==> Exporting tables from ${DB_PATH} to ${OUTPUT}..."

sqlite3 "$DB_PATH" <<SQL > "$OUTPUT"
.mode insert repos
SELECT * FROM repos;
.mode insert files
SELECT * FROM files;
.mode insert symbols
SELECT * FROM symbols;
.mode insert symbol_references
SELECT * FROM symbol_references;
SQL

# Quick stats
LINES=$(wc -l < "$OUTPUT")
SIZE=$(du -h "$OUTPUT" | cut -f1)

echo "==> Exported ${OUTPUT} (${SIZE}, ${LINES} lines)"
echo ""
echo "Tables exported:"
sqlite3 "$DB_PATH" "
  SELECT 'repos: ' || COUNT(*) FROM repos;
  SELECT 'files: ' || COUNT(*) FROM files;
  SELECT 'symbols: ' || COUNT(*) FROM symbols;
  SELECT 'symbol_references: ' || COUNT(*) FROM symbol_references;
"

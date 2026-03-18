#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DB_PATH="${1:-$HOME/.cartograph/cartograph.db}"
INPUT="${2:-cartograph-export.sql}"

if [ ! -f "$INPUT" ]; then
  echo "Error: ${INPUT} not found"
  exit 1
fi

echo "==> Clearing existing data in ${DB_PATH}..."
sqlite3 "$DB_PATH" "
  PRAGMA foreign_keys = OFF;
  DELETE FROM symbol_references;
  DELETE FROM symbols;
  DELETE FROM files;
  DELETE FROM repos;
  PRAGMA foreign_keys = ON;
"

echo "==> Importing ${INPUT} into ${DB_PATH}..."
# Disable FK checks during import to handle self-referential ordering
sqlite3 "$DB_PATH" "
  PRAGMA foreign_keys = OFF;
  .read ${INPUT}
  PRAGMA foreign_keys = ON;
"

echo "==> Done. Row counts:"
sqlite3 "$DB_PATH" "
  SELECT 'repos: ' || COUNT(*) FROM repos;
  SELECT 'files: ' || COUNT(*) FROM files;
  SELECT 'symbols: ' || COUNT(*) FROM symbols;
  SELECT 'symbol_references: ' || COUNT(*) FROM symbol_references;
"

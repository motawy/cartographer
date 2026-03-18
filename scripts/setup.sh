#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing dependencies..."
npm install

echo "==> Running migrations..."
npx tsx src/db/migrate.ts

echo ""
echo "Done! You can now run:"
echo "  npm test                              # run tests"
echo "  npm run dev -- index <repo-path>      # index a repo"

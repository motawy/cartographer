#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Starting Docker containers..."
docker compose up -d

echo "==> Waiting for PostgreSQL to be healthy..."
until docker compose exec -T postgres pg_isready -U cartograph -q 2>/dev/null; do
  sleep 1
done
echo "    PostgreSQL is ready."

echo "==> Running migrations on cartograph database..."
npx tsx src/db/migrate.ts

echo "==> Creating test database (if not exists)..."
docker compose exec -T postgres \
  psql -U cartograph -tc "SELECT 1 FROM pg_database WHERE datname = 'cartograph_test'" \
  | grep -q 1 \
  || docker compose exec -T postgres \
    psql -U cartograph -c "CREATE DATABASE cartograph_test"

echo "==> Running migrations on cartograph_test database..."
CARTOGRAPH_DB_NAME=cartograph_test npx tsx src/db/migrate.ts

echo ""
echo "Done! You can now run:"
echo "  npm test                              # run tests"
echo "  npm run dev -- index <repo-path>      # index a repo"

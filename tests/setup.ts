import { openDatabase } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';

export function createTestDb() {
  const db = openDatabase({ path: ':memory:' });
  runMigrations(db);
  return db;
}

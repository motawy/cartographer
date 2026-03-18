import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { openDatabase } from './connection.js';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function runMigrations(
  db: Database.Database,
  migrationsDir: string = join(__dirname, 'migrations')
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations ORDER BY name')
      .all() as { name: string }[])
      .map(r => r.name)
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applyMigration = db.transaction((file: string) => {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    console.log(`  Applied: ${file}`);
  });

  for (const file of files) {
    if (applied.has(file)) continue;
    applyMigration(file);
  }
}

// Allow running directly: npm run migrate
const isDirectRun = process.argv[1]?.includes('migrate');
if (isDirectRun) {
  const dbPath = process.env.CARTOGRAPH_DB_PATH
    || join(homedir(), '.cartograph', 'cartograph.db');
  const db = openDatabase({ path: dbPath });

  console.log('Running migrations...');
  try {
    runMigrations(db);
    console.log('Done.');
  } finally {
    db.close();
  }
}

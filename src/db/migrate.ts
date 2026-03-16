import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(
  pool: pg.Pool,
  migrationsDir: string = join(__dirname, 'migrations')
): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query(
    'SELECT name FROM _migrations ORDER BY name'
  );
  const applied = new Set(rows.map((r: { name: string }) => r.name));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  Applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

// Allow running directly: npm run migrate
const isDirectRun = process.argv[1]?.includes('migrate');
if (isDirectRun) {
  const pool = new pg.Pool({
    host: process.env.CARTOGRAPH_DB_HOST || 'localhost',
    port: parseInt(process.env.CARTOGRAPH_DB_PORT || '5435'),
    database: process.env.CARTOGRAPH_DB_NAME || 'cartograph',
    user: process.env.CARTOGRAPH_DB_USER || 'cartograph',
    password: process.env.CARTOGRAPH_DB_PASSWORD || 'localdev',
  });

  console.log('Running migrations...');
  try {
    await runMigrations(pool);
    console.log('Done.');
  } finally {
    await pool.end();
  }
}

import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resetDatabase(
  db: ReturnType<typeof openDatabase>,
  migrationsDir: string = join(__dirname, '..', 'db', 'migrations')
): void {
  const foreignKeysEnabled = Number(db.pragma('foreign_keys', { simple: true })) !== 0;

  db.pragma('foreign_keys = OFF');
  try {
    const objects = db.prepare(
      `SELECT type, name
       FROM sqlite_master
       WHERE type IN ('table', 'view')
         AND name NOT LIKE 'sqlite_%'`
    ).all() as { type: 'table' | 'view'; name: string }[];

    for (const { type, name } of objects) {
      const escapedName = name.replaceAll('"', '""');
      db.exec(`DROP ${type.toUpperCase()} IF EXISTS "${escapedName}"`);
    }
  } finally {
    if (foreignKeysEnabled) {
      db.pragma('foreign_keys = ON');
    }
  }

  runMigrations(db, migrationsDir);
}

export function createResetCommand(): Command {
  return new Command('reset')
    .description('Drop all tables and recreate the schema from scratch')
    .argument('[repo-path]', 'Path to repo (for config lookup)', '.')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (repoPath: string, opts: { yes?: boolean }) => {
      if (!opts.yes) {
        const { createInterface } = await import('readline');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve => {
          rl.question('This will destroy all indexed data. Continue? [y/N] ', resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== 'y') {
          console.log('Aborted.');
          return;
        }
      }

      const config = loadConfig(repoPath);
      const db = openDatabase(config.database);

      try {
        console.log('Dropping all tables...');
        console.log('Running migrations...');
        resetDatabase(db, join(__dirname, '..', 'db', 'migrations'));

        console.log('\u2705 Database reset complete.');
      } finally {
        db.close();
      }
    });
}

import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
        // Get all tables and drop them
        const tables = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).all() as { name: string }[];

        for (const { name } of tables) {
          db.exec(`DROP TABLE IF EXISTS "${name}"`);
        }

        console.log('Running migrations...');
        runMigrations(db, join(__dirname, '..', 'db', 'migrations'));

        console.log('\u2705 Database reset complete.');
      } finally {
        db.close();
      }
    });
}

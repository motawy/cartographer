import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { createPool } from '../db/connection.js';
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
      const pool = createPool(config.database);

      try {
        console.log('Dropping schema...');
        await pool.query('DROP SCHEMA public CASCADE');
        await pool.query('CREATE SCHEMA public');

        console.log('Running migrations...');
        await runMigrations(pool, join(__dirname, '..', 'db', 'migrations'));

        console.log('✅ Database reset complete.');
      } finally {
        await pool.end();
      }
    });
}

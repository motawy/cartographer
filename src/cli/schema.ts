import type Database from 'better-sqlite3';
import { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/connection.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { DbSchemaRepository } from '../db/repositories/db-schema-repository.js';
import { handleSchema } from '../mcp/tools/schema.js';

export function renderSchemaForRepo(
  db: Database.Database,
  repoPath: string,
  query?: string,
  limit?: number
): string {
  const absoluteRepoPath = resolve(repoPath);
  const repo = new RepoRepository(db).findByPath(absoluteRepoPath);

  if (!repo) {
    throw new Error(`No index found for ${absoluteRepoPath}. Run \`cartograph index\` first.`);
  }

  return handleSchema({
    repoId: repo.id,
    schemaRepo: new DbSchemaRepository(db),
  }, { query, limit });
}

export function createSchemaCommand(): Command {
  return new Command('schema')
    .description('List or search current indexed database tables')
    .argument('[query]', 'Optional table-name search')
    .option('--repo-path <path>', 'Repository path', '.')
    .option('--limit <n>', 'Maximum number of tables to show', '50')
    .action((query: string | undefined, opts: { repoPath: string; limit: string }) => {
      const config = loadConfig(opts.repoPath);
      const db = openDatabase(config.database);

      try {
        console.log(
          renderSchemaForRepo(
            db,
            opts.repoPath,
            query,
            Number.parseInt(opts.limit, 10)
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}

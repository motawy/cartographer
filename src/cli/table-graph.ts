import type Database from 'better-sqlite3';
import { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/connection.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { DbSchemaRepository } from '../db/repositories/db-schema-repository.js';
import { handleTableGraph } from '../mcp/tools/table-graph.js';

export function renderTableGraphForRepo(
  db: Database.Database,
  repoPath: string,
  tableName: string,
  depth?: number
): string {
  const absoluteRepoPath = resolve(repoPath);
  const repo = new RepoRepository(db).findByPath(absoluteRepoPath);

  if (!repo) {
    throw new Error(`No index found for ${absoluteRepoPath}. Run \`cartograph index\` first.`);
  }

  return handleTableGraph({
    repoId: repo.id,
    schemaRepo: new DbSchemaRepository(db),
  }, { name: tableName, depth });
}

export function createTableGraphCommand(): Command {
  return new Command('table-graph')
    .description('Show the foreign-key neighborhood around a table')
    .argument('<table>', 'Table name')
    .option('--repo-path <path>', 'Repository path', '.')
    .option('--depth <n>', 'Traversal depth', '1')
    .action((tableName: string, opts: { repoPath: string; depth: string }) => {
      const config = loadConfig(opts.repoPath);
      const db = openDatabase(config.database);

      try {
        console.log(
          renderTableGraphForRepo(
            db,
            opts.repoPath,
            tableName,
            Number.parseInt(opts.depth, 10)
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

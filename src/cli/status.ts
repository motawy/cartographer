import type Database from 'better-sqlite3';
import { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/connection.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { handleStatus } from '../mcp/tools/status.js';

export function renderStatusForRepo(
  db: Database.Database,
  repoPath: string
): string {
  const absoluteRepoPath = resolve(repoPath);
  const repo = new RepoRepository(db).findByPath(absoluteRepoPath);

  if (!repo) {
    throw new Error(`No index found for ${absoluteRepoPath}. Run \`cartograph index\` first.`);
  }

  return handleStatus({ db, repoId: repo.id });
}

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show index freshness, coverage, and unresolved-reference trust')
    .argument('[repo-path]', 'Path to repo', '.')
    .action((repoPath: string) => {
      const config = loadConfig(repoPath);
      const db = openDatabase(config.database);

      try {
        console.log(renderStatusForRepo(db, repoPath));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}

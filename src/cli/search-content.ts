import type Database from 'better-sqlite3';
import { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/connection.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { FileRepository } from '../db/repositories/file-repository.js';
import { SymbolRepository } from '../db/repositories/symbol-repository.js';
import { handleSearchContent } from '../mcp/tools/search-content.js';

export function renderSearchContentForRepo(
  db: Database.Database,
  repoPath: string,
  query: string,
  path?: string,
  limit?: number
): string {
  const absoluteRepoPath = resolve(repoPath);
  const repo = new RepoRepository(db).findByPath(absoluteRepoPath);

  if (!repo) {
    throw new Error(`No index found for ${absoluteRepoPath}. Run \`cartograph index\` first.`);
  }

  return handleSearchContent({
    repoId: repo.id,
    repoPath: absoluteRepoPath,
    fileRepo: new FileRepository(db),
    symbolRepo: new SymbolRepository(db),
  }, { query, path, limit });
}

export function createSearchContentCommand(): Command {
  return new Command('search-content')
    .description('Search indexed source content by literal substring and map matches back to enclosing symbols')
    .argument('<query>', 'Literal text to search for')
    .option('--repo-path <path>', 'Repository path', '.')
    .option('--path <path>', 'Optional file-path substring filter')
    .option('--limit <n>', 'Maximum number of matches to show', '20')
    .action((query: string, opts: { repoPath: string; path?: string; limit: string }) => {
      const config = loadConfig(opts.repoPath);
      const db = openDatabase(config.database);

      try {
        console.log(
          renderSearchContentForRepo(
            db,
            opts.repoPath,
            query,
            opts.path,
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

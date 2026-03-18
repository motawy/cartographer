import { Command } from 'commander';
import { resolve } from 'path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/connection.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { createServer } from '../mcp/server.js';

export function createServeCommand(): Command {
  return new Command('serve')
    .description('Start the MCP server for AI tool integration')
    .option('--repo-path <path>', 'Repository path', '.')
    .action(async (opts: { repoPath: string }) => {
      const config = loadConfig(opts.repoPath);
      const db = openDatabase(config.database);
      const repoRepo = new RepoRepository(db);
      const repoPath = resolve(opts.repoPath);
      const repo = repoRepo.findByPath(repoPath);

      if (!repo) {
        console.error(`No index found for ${repoPath}. Run \`cartograph index\` first.`);
        db.close();
        process.exit(1);
      }

      const server = createServer({ db, repoId: repo.id, repoPath });
      const transport = new StdioServerTransport();

      const shutdown = async () => {
        await server.close();
        db.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await server.connect(transport);
      // Server is now running — stdio transport keeps the process alive
    });
}

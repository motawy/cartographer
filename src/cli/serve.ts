import { Command } from 'commander';
import { resolve } from 'path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { createPool } from '../db/connection.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { createServer } from '../mcp/server.js';

export function createServeCommand(): Command {
  return new Command('serve')
    .description('Start the MCP server for AI tool integration')
    .option('--repo-path <path>', 'Repository path', '.')
    .action(async (opts: { repoPath: string }) => {
      const config = loadConfig(opts.repoPath);
      const pool = createPool(config.database);
      const repoRepo = new RepoRepository(pool);
      const repoPath = resolve(opts.repoPath);
      const repo = await repoRepo.findByPath(repoPath);

      if (!repo) {
        console.error(`No index found for ${repoPath}. Run \`cartograph index\` first.`);
        await pool.end();
        process.exit(1);
      }

      const server = await createServer({ pool, repoId: repo.id, repoPath });
      const transport = new StdioServerTransport();

      const shutdown = async () => {
        await server.close();
        await pool.end();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await server.connect(transport);
      // Server is now running — stdio transport keeps the process alive
    });
}

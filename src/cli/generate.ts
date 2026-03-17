import { Command } from 'commander';
import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { loadConfig } from '../config.js';
import { createPool } from '../db/connection.js';
import { GeneratePipeline } from '../output/generate-pipeline.js';
import { injectSection } from '../output/claudemd-injector.js';
import { GenerateError } from '../errors.js';

export function createGenerateCommand(): Command {
  return new Command('generate')
    .description('Inject Cartograph tool guidance into your CLAUDE.md')
    .argument('<repo-path>', 'Path to the indexed repository')
    .option('--claude-md <path>', 'Path to CLAUDE.md to inject into (default: auto-detect)')
    .action(async (repoPath: string, opts: { claudeMd?: string }) => {
      const config = loadConfig(repoPath);
      const pool = createPool(config.database);

      try {
        const pipeline = new GeneratePipeline(pool);
        const section = await pipeline.generateClaudeMdContent(repoPath);

        // Resolve CLAUDE.md path
        const claudeMdPath = opts.claudeMd || findClaudeMd(resolve(repoPath));
        const existing = existsSync(claudeMdPath)
          ? readFileSync(claudeMdPath, 'utf-8')
          : '';

        const updated = injectSection(existing, section);
        writeFileSync(claudeMdPath, updated);

        const verb = existing.includes('CARTOGRAPH:START') ? 'Updated' : 'Added';
        console.log(`\n${verb} Cartograph section in ${claudeMdPath}\n`);
      } catch (err) {
        if (err instanceof GenerateError) {
          console.error(err.message);
          process.exit(1);
        }
        throw err;
      } finally {
        await pool.end();
      }
    });
}

function findClaudeMd(repoPath: string): string {
  // Priority: CLAUDE.md at root, then .claude/CLAUDE.md
  const rootPath = `${repoPath}/CLAUDE.md`;
  if (existsSync(rootPath)) return rootPath;

  const dotClaudePath = `${repoPath}/.claude/CLAUDE.md`;
  if (existsSync(dotClaudePath)) return dotClaudePath;

  // Default: create at root
  return rootPath;
}

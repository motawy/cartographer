import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { createPool } from '../db/connection.js';
import { GeneratePipeline } from '../output/generate-pipeline.js';
import { GenerateError } from '../errors.js';

export function createGenerateCommand(): Command {
  return new Command('generate')
    .description('Generate AI context files from the codebase index')
    .argument('<repo-path>', 'Path to the indexed repository')
    .option('--output-dir <path>', 'Output directory (default: <repo-path>/.cartograph)')
    .action(async (repoPath: string, opts: { outputDir?: string }) => {
      const config = loadConfig(repoPath);
      const pool = createPool(config.database);

      try {
        const pipeline = new GeneratePipeline(pool);
        await pipeline.run(repoPath, { outputDir: opts.outputDir });
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

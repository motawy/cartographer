import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import type { CartographConfig } from './types.js';

const DEFAULT_EXCLUDES = ['vendor/', 'node_modules/', '.git/'];

export function loadConfig(repoPath: string): CartographConfig {
  const configPath = join(repoPath, '.cartograph.yml');

  const defaults: CartographConfig = {
    languages: ['php'],
    exclude: DEFAULT_EXCLUDES,
    additionalSources: [],
    database: {
      path: process.env.CARTOGRAPH_DB_PATH
        || join(homedir(), '.cartograph', 'cartograph.db'),
    },
  };

  if (!existsSync(configPath)) {
    return defaults;
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);
  const additionalSources = parsed?.additional_sources
    || parsed?.additionalSources
    || defaults.additionalSources;

  return {
    languages: parsed?.languages || defaults.languages,
    exclude: parsed?.exclude
      ? [...DEFAULT_EXCLUDES, ...parsed.exclude]
      : defaults.exclude,
    additionalSources,
    database: { ...defaults.database, ...(parsed?.database || {}) },
  };
}

import { resolve } from 'path';
import type { AdditionalSourceConfig, CartographConfig } from '../types.js';

export function resolveIndexedFilePath(
  repoPath: string,
  indexedPath: string,
  config: Pick<CartographConfig, 'additionalSources'>
): string | null {
  if (!indexedPath.startsWith('@')) {
    return resolve(repoPath, indexedPath);
  }

  const firstSlash = indexedPath.indexOf('/');
  if (firstSlash === -1) return null;

  const label = indexedPath.slice(1, firstSlash);
  const relativePath = indexedPath.slice(firstSlash + 1);
  const source = findAdditionalSource(config.additionalSources, label);
  if (!source) return null;

  return resolve(repoPath, source.path, relativePath);
}

export function normalizeSourceLabel(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    throw new Error(`Invalid additional source label: "${label}"`);
  }

  return normalized;
}

function findAdditionalSource(
  sources: AdditionalSourceConfig[],
  label: string
): AdditionalSourceConfig | undefined {
  return sources.find((source) => normalizeSourceLabel(source.label) === label);
}

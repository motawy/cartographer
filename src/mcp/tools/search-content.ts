import { readFileSync } from 'fs';
import { loadConfig } from '../../config.js';
import { resolveIndexedFilePath } from '../../utils/indexed-path.js';
import type { ToolDeps } from '../types.js';

interface SearchContentParams {
  query: string;
  path?: string;
  limit?: number;
}

type SearchContentDeps = Pick<ToolDeps, 'repoId' | 'repoPath' | 'fileRepo' | 'symbolRepo'>;

interface ContentMatch {
  filePath: string;
  lineNumber: number;
  symbolName: string | null;
  symbolKind: string | null;
  preview: string;
}

export function handleSearchContent(deps: SearchContentDeps, params: SearchContentParams): string {
  const { repoId, repoPath, fileRepo, symbolRepo } = deps;
  if (!repoPath) {
    throw new Error('Repository path is not available for content search.');
  }
  if (!fileRepo) {
    throw new Error('File repository is not available for content search.');
  }

  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  const config = loadConfig(repoPath);
  const files = fileRepo.listByRepo(repoId).filter((file) => {
    if (params.path && !file.path.includes(params.path)) return false;
    return file.language !== 'sql';
  });

  const queryLower = params.query.toLowerCase();
  const matches: ContentMatch[] = [];

  for (const file of files) {
    const absolutePath = resolveIndexedFilePath(repoPath, file.path, config);
    if (!absolutePath) continue;

    let content: string;
    try {
      content = readFileSync(absolutePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx]!;
      if (!line.toLowerCase().includes(queryLower)) continue;

      const lineNumber = idx + 1;
      const symbol = symbolRepo.findInnermostByFileAndLine(repoId, file.path, lineNumber);
      matches.push({
        filePath: file.path,
        lineNumber,
        symbolName: symbol?.qualifiedName ?? null,
        symbolKind: symbol?.kind ?? null,
        preview: line.trim(),
      });

      if (matches.length >= limit) break;
    }

    if (matches.length >= limit) break;
  }

  if (matches.length === 0) {
    if (params.path) {
      return `No indexed content matches "${params.query}" in path "${params.path}".`;
    }
    return `No indexed content matches "${params.query}".`;
  }

  const lines: string[] = [];
  lines.push(`## Content Search: "${params.query}"`);
  lines.push(`- Matches: ${matches.length}`);
  if (params.path) {
    lines.push(`- Path filter: ${params.path}`);
  }
  lines.push('');

  for (const match of matches) {
    const owner = match.symbolName
      ? `${match.symbolName}${match.symbolKind ? ` (${match.symbolKind})` : ''}`
      : 'No enclosing symbol';
    lines.push(`- ${owner}`);
    lines.push(`  ${match.filePath}:${match.lineNumber}`);
    lines.push(`  ${match.preview}`);
  }

  if (matches.length === limit) {
    lines.push('');
    lines.push('Limit reached. Refine with `path` or increase `limit` if needed.');
  }

  return lines.join('\n');
}

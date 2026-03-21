import type { ToolDeps } from '../types.js';

interface FindParams {
  query: string;
  kind?: string;
  limit?: number;
  path?: string;
}

export function handleFind(deps: ToolDeps, params: FindParams): string {
  const { repoId, symbolRepo } = deps;
  const limit = Math.max(1, Math.min(params.limit ?? 20, 50));

  // Convert * to % for SQL, wrap bare queries in %...%
  let pattern = params.query;
  if (pattern.includes('*')) {
    pattern = pattern.replace(/\*/g, '%');
  }
  // Always ensure leading/trailing % so searches match anywhere in qualified name.
  // Users search by class name ("UserService") not full namespace ("App\Services\UserService").
  if (!pattern.startsWith('%')) pattern = `%${pattern}`;
  if (!pattern.endsWith('%')) pattern = `${pattern}%`;

  const results = symbolRepo.search(repoId, pattern, params.kind, limit, params.path);

  if (results.length === 0) {
    const symbolSuggestions = symbolRepo.suggestSymbols(repoId, params.query, params.kind, params.path);

    if (params.path) {
      const pathHints = symbolRepo.suggestPaths(repoId, params.path);
      const lines = [`No symbols found matching "${params.query}" in path "${params.path}".`];
      if (symbolSuggestions.length > 0) {
        lines.push('', 'Did you mean one of these symbols?');
        lines.push(...symbolSuggestions.map((suggestion) =>
          `- ${suggestion.qualifiedName ?? suggestion.name} (${suggestion.kind}) — ${suggestion.filePath}`
        ));
      }
      if (pathHints.length > 0) {
        lines.push('', 'Did you mean one of these paths?');
        lines.push(...pathHints.map((pathHint) => `- ${pathHint}`));
      } else if (symbolSuggestions.length === 0) {
        lines.push('No files match that path fragment.');
      }
      return lines.join('\n');
    }

    if (symbolSuggestions.length > 0) {
      return `No symbols found matching "${params.query}".\n\nDid you mean one of these symbols?\n${symbolSuggestions.map((suggestion) =>
        `- ${suggestion.qualifiedName ?? suggestion.name} (${suggestion.kind}) — ${suggestion.filePath}`
      ).join('\n')}`;
    }

    return `No symbols found matching "${params.query}".`;
  }

  const kindLabel = params.kind ? ` (kind: ${params.kind})` : '';
  const pathLabel = params.path ? ` in ${params.path}` : '';
  const lines: string[] = [];
  lines.push(`## Search: "${params.query}"${kindLabel}${pathLabel}\n`);
  lines.push(`Found ${results.length} match${results.length === 1 ? '' : 'es'}:\n`);
  lines.push('| Symbol | Kind | File | Lines |');
  lines.push('|--------|------|------|-------|');

  for (const r of results) {
    lines.push(`| ${r.qualifiedName ?? r.name} | ${r.kind} | ${r.filePath} | ${r.lineStart}-${r.lineEnd} |`);
  }

  return lines.join('\n');
}

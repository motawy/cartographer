import type { RepoStats } from './generate-pipeline.js';

const TOKEN_BUDGET_CHARS = 12000; // ~3K tokens at 4 chars/token

export function generateRoot(stats: RepoStats): string {
  const lines: string[] = [];

  // Project Overview
  lines.push(`# Project Overview\n`);
  lines.push(`**Language:** ${capitalize(stats.language)} | **Files:** ${stats.totalFiles.toLocaleString()} | **Symbols:** ${stats.totalSymbols.toLocaleString()} | **References:** ${stats.totalReferences.toLocaleString()}\n`);

  // Architecture
  lines.push(`## Architecture\n`);
  lines.push(`${detectArchitecture(stats.directories)}\n`);

  // Directory Map
  lines.push(`## Directory Map\n`);
  lines.push('```');
  let shown = 0;
  const maxDirs = 30;
  for (const dir of stats.directories) {
    if (shown >= maxDirs) {
      lines.push(`... and ${stats.directories.length - maxDirs} more directories`);
      break;
    }
    const kinds = dir.dominantKinds.length > 0
      ? ` (${dir.dominantKinds.join(', ')})`
      : '';
    lines.push(`${dir.path.padEnd(35)} ${String(dir.symbolCount).padStart(5)} symbols${kinds}`);
    shown++;
  }
  lines.push('```\n');

  // Context Files
  lines.push(`## Context Files\n`);
  lines.push(`- [Modules](modules.md) — what exists where, grouped by area`);
  lines.push(`- [Dependencies](dependencies.md) — how modules connect (directed graph)`);
  lines.push(`- [Conventions](conventions.md) — coding patterns and style\n`);

  let result = lines.join('\n');

  // Enforce token budget
  if (result.length > TOKEN_BUDGET_CHARS) {
    result = result.substring(0, TOKEN_BUDGET_CHARS) + '\n\n... (truncated to fit token budget)\n';
  }

  return result;
}

function detectArchitecture(dirs: { path: string; classCount: number }[]): string {
  const dirNames = new Set(dirs.map(d => d.path.split('/').pop()?.toLowerCase()));
  const patterns: string[] = [];

  if (dirNames.has('controllers') || dirNames.has('http')) {
    patterns.push('HTTP controllers');
  }
  if (dirNames.has('services')) {
    patterns.push('service layer');
  }
  if (dirNames.has('repositories')) {
    patterns.push('repository pattern for data access');
  }
  if (dirNames.has('models')) {
    patterns.push('model layer');
  }
  if (dirNames.has('contracts') || dirNames.has('interfaces')) {
    patterns.push('interface contracts');
  }

  if (patterns.length === 0) {
    return 'Architecture pattern could not be determined from directory structure.';
  }

  return `This codebase uses ${patterns.join(', ')}. ` +
    `Top-level directories organize code by responsibility.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

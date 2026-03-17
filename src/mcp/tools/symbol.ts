import type { ReferenceRecord } from '../../db/repositories/reference-repository.js';
import type { ToolDeps, RepoStats, DependentRow } from '../types.js';

interface SymbolParams {
  name: string;
}

export async function handleSymbol(deps: ToolDeps, stats: RepoStats, params: SymbolParams): Promise<string> {
  const { repoId, symbolRepo, refRepo } = deps;
  const { name } = params;

  // Search with suffix pattern — works for both exact qualified names and short names.
  // Escape backslashes for ILIKE (PostgreSQL treats \ as escape char in ILIKE patterns).
  const escapedName = name.replace(/\\/g, '\\\\');
  const searchResults = await symbolRepo.search(repoId, `%${escapedName}`, undefined, 10);
  let matches: { symbol: (typeof searchResults)[0]; filePath: string }[] = [];

  if (searchResults.length === 0) {
    return `Symbol not found: "${name}". Use cartograph_find to search.`;
  }

  // Prefer exact match (case-insensitive) when available
  const exactMatch = searchResults.find(r => r.qualifiedName?.toLowerCase() === name.toLowerCase());
  if (exactMatch) {
    matches = [{ symbol: exactMatch, filePath: exactMatch.filePath }];
  } else {
    matches = searchResults.map(r => ({ symbol: r, filePath: r.filePath }));
  }

  const sections: string[] = [];

  for (const match of matches) {
    const sym = match.symbol!;
    const lines: string[] = [];

    lines.push(`## ${sym.qualifiedName ?? sym.name} (${sym.kind})`);
    lines.push(`File: ${match.filePath}:${sym.lineStart}-${sym.lineEnd}`);
    if (sym.visibility) lines.push(`Visibility: ${sym.visibility}`);

    // Forward deps (fetched early so conventions context can reuse them)
    const forwardDeps = await refRepo.findDependencies(sym.id);

    // Conventions context for classes
    if (sym.kind === 'class') {
      const context = buildConventionsContext(forwardDeps, stats);
      if (context) lines.push(`Context: ${context}`);
    }

    lines.push('');
    if (forwardDeps.length > 0) {
      lines.push(`### Depends on (${forwardDeps.length})`);
      for (const dep of forwardDeps) {
        const targetName = dep.targetSymbolId
          ? (await symbolRepo.findById(dep.targetSymbolId))?.qualifiedName ?? dep.targetQualifiedName
          : `${dep.targetQualifiedName} (unresolved)`;
        const lineRef = dep.lineNumber ? `, line ${dep.lineNumber}` : '';
        lines.push(`- ${targetName} (${dep.referenceKind}${lineRef})`);
      }
      lines.push('');
    }

    // Reverse deps
    const reverseDeps = (await refRepo.findDependents(sym.id, 1)) as unknown as DependentRow[];
    if (reverseDeps.length > 0) {
      lines.push(`### Used by (${reverseDeps.length})`);
      for (const dep of reverseDeps) {
        const line = dep.line_number ? `, line ${dep.line_number}` : '';
        lines.push(`- ${dep.source_qualified_name} (${dep.reference_kind}${line})`);
        lines.push(`  ${dep.source_file_path}`);
      }
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n---\n\n');
}

function buildConventionsContext(
  forwardDeps: ReferenceRecord[],
  stats: RepoStats
): string | null {
  const parts: string[] = [];

  const implementations = forwardDeps.filter(d => d.referenceKind === 'implementation');
  const inheritance = forwardDeps.filter(d => d.referenceKind === 'inheritance');
  const traits = forwardDeps.filter(d => d.referenceKind === 'trait_use');

  if (implementations.length > 0) {
    const ifaceName = implementations[0].targetQualifiedName.split('\\').pop() ?? implementations[0].targetQualifiedName;
    const pct = stats.totalClasses > 0 ? Math.round((stats.classesWithInterface / stats.totalClasses) * 100) : 0;
    parts.push(`Implements ${ifaceName} (${pct}% of classes do)`);
  }

  if (inheritance.length > 0) {
    const baseName = inheritance[0].targetQualifiedName.split('\\').pop() ?? inheritance[0].targetQualifiedName;
    parts.push(`Extends ${baseName}`);
  }

  if (traits.length > 0) {
    const pct = stats.totalClasses > 0 ? Math.round((stats.classesWithTraits / stats.totalClasses) * 100) : 0;
    parts.push(`Uses ${traits.length} trait${traits.length > 1 ? 's' : ''} (${pct}% of classes do)`);
  }

  if (parts.length === 0 && stats.totalClasses > 0) {
    const noIfacePct = stats.totalClasses > 0
      ? Math.round(((stats.totalClasses - stats.classesWithInterface) / stats.totalClasses) * 100)
      : 0;
    parts.push(`No interface, no base class (matches ${noIfacePct}% of classes)`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : null;
}

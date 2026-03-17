import type { ToolDeps } from '../types.js';

const CALL_KINDS = new Set(['static_call', 'self_call', 'instantiation']);

interface FlowParams {
  symbol: string;
  depth?: number;
}

export async function handleFlow(deps: ToolDeps, params: FlowParams): Promise<string> {
  const { repoId, symbolRepo, refRepo } = deps;
  const maxDepth = Math.max(1, Math.min(params.depth ?? 5, 15));

  const startSymbol = await symbolRepo.findByQualifiedName(repoId, params.symbol);
  if (!startSymbol) {
    return `Symbol not found: "${params.symbol}". Use cartograph_find to search.`;
  }

  const lines: string[] = [];
  lines.push(`## Flow: ${startSymbol.qualifiedName} (depth ${maxDepth})\n`);

  const visited = new Set<number>();
  const queue: { symbolId: number; qualifiedName: string; depth: number }[] = [
    { symbolId: startSymbol.id, qualifiedName: startSymbol.qualifiedName!, depth: 0 },
  ];
  let maxReached = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.symbolId)) continue;
    if (current.depth > maxDepth) continue;
    visited.add(current.symbolId);

    const indent = '  '.repeat(current.depth);
    const prefix = current.depth === 0
      ? `${current.depth + 1}.`
      : `${current.depth + 1}. →`;
    lines.push(`${indent}${prefix} ${current.qualifiedName}`);
    maxReached = Math.max(maxReached, current.depth);

    const refs = await refRepo.findDependencies(current.symbolId);
    const callRefs = refs.filter(r => CALL_KINDS.has(r.referenceKind));

    for (const ref of callRefs) {
      if (ref.targetSymbolId && !visited.has(ref.targetSymbolId)) {
        const target = await symbolRepo.findById(ref.targetSymbolId);
        if (target) {
          queue.push({
            symbolId: target.id,
            qualifiedName: target.qualifiedName!,
            depth: current.depth + 1,
          });
        }
      } else if (!ref.targetSymbolId) {
        const leafIndent = '  '.repeat(current.depth + 1);
        const lineRef = ref.lineNumber ? ` (line ${ref.lineNumber})` : '';
        lines.push(`${leafIndent}→ ${ref.targetQualifiedName}${lineRef} (unresolved)`);
      }
    }
  }

  lines.push('');
  lines.push(`Nodes visited: ${visited.size} | Max depth reached: ${maxReached}`);

  return lines.join('\n');
}

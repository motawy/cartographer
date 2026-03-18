import type { ToolDeps } from '../types.js';

interface DepsParams {
  symbol: string;
  depth?: number;
}

export function handleDeps(deps: ToolDeps, params: DepsParams): string {
  const { repoId, symbolRepo, refRepo } = deps;
  const maxDepth = Math.max(1, Math.min(params.depth ?? 3, 10));

  const startSymbol = symbolRepo.findByQualifiedName(repoId, params.symbol);
  if (!startSymbol) {
    return `Symbol not found: "${params.symbol}". Use cartograph_find to search.`;
  }

  const lines: string[] = [];
  lines.push(`## Dependencies: ${startSymbol.qualifiedName} (depth ${maxDepth})\n`);

  // BFS forward traversal
  const visited = new Set<number>();
  interface QueueItem {
    symbolId: number;
    qualifiedName: string;
    depth: number;
    via?: string; // "getBuilderName(), line 21" — which method created this edge
  }
  const queue: QueueItem[] = [
    { symbolId: startSymbol.id, qualifiedName: startSymbol.qualifiedName!, depth: 0 },
  ];
  let maxReached = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.symbolId)) continue;
    if (current.depth > maxDepth) continue;
    visited.add(current.symbolId);

    const indent = '  '.repeat(current.depth);
    const prefix = current.depth === 0 ? `${current.depth + 1}.` : `→`;
    const viaLabel = current.via ? `  (via ${current.via})` : '';
    lines.push(`${indent}${prefix} ${current.qualifiedName}${viaLabel}`);
    maxReached = Math.max(maxReached, current.depth);

    const refs = refRepo.findDependencies(current.symbolId);

    // At depth 0: show all reference kinds. At deeper levels: call-type + class_reference.
    // class_reference covers return Foo::class wiring (Route→Controller→Builder→Model).
    const filteredRefs = current.depth === 0
      ? refs
      : refs.filter(r => ['static_call', 'self_call', 'instantiation', 'class_reference'].includes(r.referenceKind));

    for (const ref of filteredRefs) {
      // Build "via" context: which method created this edge
      const viaMethod = ref.sourceSymbolName && ref.sourceSymbolId !== current.symbolId
        ? ref.sourceSymbolName : null;
      const viaLine = ref.lineNumber ? `line ${ref.lineNumber}` : null;
      const via = viaMethod
        ? `${viaMethod}()${viaLine ? `, ${viaLine}` : ''}`
        : viaLine ? viaLine : undefined;

      if (ref.targetSymbolId && !visited.has(ref.targetSymbolId)) {
        const target = symbolRepo.findById(ref.targetSymbolId);
        if (target) {
          queue.push({
            symbolId: target.id,
            qualifiedName: target.qualifiedName!,
            depth: current.depth + 1,
            via,
          });
        }
      } else if (!ref.targetSymbolId) {
        // Unresolved reference — show as leaf
        const leafIndent = '  '.repeat(current.depth + 1);
        const viaStr = via ? `, via ${via}` : '';
        lines.push(`${leafIndent}→ ${ref.targetQualifiedName} (${ref.referenceKind}${viaStr}, unresolved)`);
      }
    }
  }

  lines.push('');
  lines.push(`Nodes visited: ${visited.size} | Max depth reached: ${maxReached}`);

  return lines.join('\n');
}

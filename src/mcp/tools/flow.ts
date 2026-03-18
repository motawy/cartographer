import type { ToolDeps } from '../types.js';
import type { ReferenceRecord } from '../../db/repositories/reference-repository.js';

const CALL_KINDS = new Set(['static_call', 'self_call', 'instantiation', 'class_reference']);

interface FlowParams {
  symbol: string;
  depth?: number;
}

export function handleFlow(deps: ToolDeps, params: FlowParams): string {
  const { repoId, symbolRepo, refRepo } = deps;
  const maxDepth = Math.max(1, Math.min(params.depth ?? 5, 15));

  const startSymbol = symbolRepo.findByQualifiedName(repoId, params.symbol);
  if (!startSymbol) {
    return `Symbol not found: "${params.symbol}". Use cartograph_find to search.`;
  }

  const lines: string[] = [];
  lines.push(`## Flow: ${startSymbol.qualifiedName} (depth ${maxDepth})\n`);

  const visited = new Set<number>();
  interface QueueItem {
    symbolId: number;
    qualifiedName: string;
    depth: number;
    via?: string;
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
    const prefix = current.depth === 0
      ? `${current.depth + 1}.`
      : `${current.depth + 1}. \u2192`;
    const viaLabel = current.via ? `  (${current.via})` : '';
    lines.push(`${indent}${prefix} ${current.qualifiedName}${viaLabel}`);
    maxReached = Math.max(maxReached, current.depth);

    // Get direct refs (includes children's refs via findDependencies)
    let refs = refRepo.findDependencies(current.symbolId);

    // For classes: also include parent class's template methods' refs
    // This traces through the template method pattern:
    //   BaseRoute::getControllerInstance calls $this->getControllerName()
    //   Child overrides getControllerName() → return Controller::class
    const parentRefs = getParentMethodRefs(current.symbolId, symbolRepo, refRepo);
    if (parentRefs.length > 0) {
      refs = [...refs, ...parentRefs];
    }

    const callRefs = refs.filter(r => CALL_KINDS.has(r.referenceKind));

    // Resolve self_calls: if a parent's self_call targets ParentClass::method,
    // and the current child overrides that method, resolve to the child's version
    const children = symbolRepo.findChildren(current.symbolId);
    const childMethodNames = new Set(children.map(c => c.name));

    for (const ref of callRefs) {
      // Check if this self_call can be resolved to a child override
      let targetId = ref.targetSymbolId;
      let targetName = ref.targetQualifiedName;

      if (ref.referenceKind === 'self_call' && ref.targetQualifiedName.includes('::')) {
        const methodName = ref.targetQualifiedName.split('::').pop()?.toLowerCase();
        if (methodName && childMethodNames.has(methodName)) {
          // The child overrides this method — find the child's version
          const childMethod = children.find(c => c.name.toLowerCase() === methodName);
          if (childMethod) {
            // Don't enqueue the method itself, enqueue what it references
            const methodRefs = refRepo.findDependencies(childMethod.id);
            const methodCallRefs = methodRefs.filter(r => CALL_KINDS.has(r.referenceKind));
            for (const mr of methodCallRefs) {
              if (mr.targetSymbolId && !visited.has(mr.targetSymbolId)) {
                const target = symbolRepo.findById(mr.targetSymbolId);
                if (target) {
                  const via = ref.sourceSymbolName
                    ? `${ref.sourceSymbolName}() \u2192 ${childMethod.name}()`
                    : `via ${childMethod.name}()`;
                  queue.push({
                    symbolId: target.id,
                    qualifiedName: target.qualifiedName!,
                    depth: current.depth + 1,
                    via,
                  });
                }
              }
            }
            continue; // Skip the original self_call — we followed the override
          }
        }
      }

      if (targetId && !visited.has(targetId)) {
        const target = symbolRepo.findById(targetId);
        if (target) {
          const via = ref.sourceSymbolName ? `via ${ref.sourceSymbolName}()` : undefined;
          queue.push({
            symbolId: target.id,
            qualifiedName: target.qualifiedName!,
            depth: current.depth + 1,
            via,
          });
        }
      } else if (!targetId) {
        const leafIndent = '  '.repeat(current.depth + 1);
        const via = ref.sourceSymbolName ? `, via ${ref.sourceSymbolName}()` : '';
        const lineRef = ref.lineNumber ? ` (line ${ref.lineNumber})` : '';
        lines.push(`${leafIndent}\u2192 ${targetName}${lineRef}${via} (unresolved)`);
      }
    }
  }

  lines.push('');
  lines.push(`Nodes visited: ${visited.size} | Max depth reached: ${maxReached}`);

  return lines.join('\n');
}

/**
 * Get refs from parent class's methods (template method pattern).
 * When a class inherits from BaseRoute, BaseRoute::getControllerInstance
 * calls getControllerName() / getBuilderName(). We want to trace through those.
 */
function getParentMethodRefs(
  symbolId: number,
  symbolRepo: ToolDeps['symbolRepo'],
  refRepo: ToolDeps['refRepo']
): ReferenceRecord[] {
  // Find inheritance edges from this symbol
  const directRefs = refRepo.findDependencies(symbolId);
  const inheritanceRefs = directRefs.filter(r => r.referenceKind === 'inheritance');

  const parentRefs: ReferenceRecord[] = [];
  for (const inh of inheritanceRefs) {
    if (!inh.targetSymbolId) continue;
    // Get the parent's methods' refs
    const parentMethodRefs = refRepo.findDependencies(inh.targetSymbolId);
    // Only include self_calls (template method calls like $this->getControllerName())
    const selfCalls = parentMethodRefs.filter(r => r.referenceKind === 'self_call');
    parentRefs.push(...selfCalls);
  }

  return parentRefs;
}

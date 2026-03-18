import type { ToolDeps } from '../types.js';
import type { SymbolRecord } from '../../db/repositories/symbol-repository.js';
import type { ReferenceRecord } from '../../db/repositories/reference-repository.js';

interface CompareParams {
  symbolA: string;
  symbolB: string;
}

export async function handleCompare(deps: ToolDeps, params: CompareParams): Promise<string> {
  const { repoId, symbolRepo, refRepo } = deps;

  const symA = await resolveSymbol(repoId, params.symbolA, symbolRepo);
  if (!symA) {
    return `Symbol A not found: "${params.symbolA}". Use cartograph_find to search.`;
  }

  const symB = await resolveSymbol(repoId, params.symbolB, symbolRepo);
  if (!symB) {
    return `Symbol B not found: "${params.symbolB}". Use cartograph_find to search.`;
  }

  const childrenA = await symbolRepo.findChildren(symA.id);
  const childrenB = await symbolRepo.findChildren(symB.id);

  // Load references for all children to show what they wire to
  const refsMap = new Map<number, ReferenceRecord[]>();
  for (const child of [...childrenA, ...childrenB]) {
    const refs = await refRepo.findDependencies(child.id);
    if (refs.length > 0) {
      refsMap.set(child.id, refs);
    }
  }

  const namesA = new Set(childrenA.map(c => c.name));
  const namesB = new Set(childrenB.map(c => c.name));

  const onlyInA = childrenA.filter(c => !namesB.has(c.name));
  const onlyInB = childrenB.filter(c => !namesA.has(c.name));
  const shared = childrenA.filter(c => namesB.has(c.name));

  const lines: string[] = [];
  lines.push(`## Compare: ${symA.qualifiedName} vs ${symB.qualifiedName}\n`);

  lines.push(`### In ${symA.qualifiedName} but NOT in ${symB.qualifiedName}:`);
  if (onlyInA.length === 0) {
    lines.push('(none)');
  } else {
    for (const c of onlyInA) {
      lines.push(formatChild(c, refsMap.get(c.id)));
    }
  }
  lines.push('');

  lines.push(`### In ${symB.qualifiedName} but NOT in ${symA.qualifiedName}:`);
  if (onlyInB.length === 0) {
    lines.push('(none)');
  } else {
    for (const c of onlyInB) {
      lines.push(formatChild(c, refsMap.get(c.id)));
    }
  }
  lines.push('');

  lines.push(`### Shared (${shared.length}):`);
  for (const c of shared) {
    const refs = refsMap.get(c.id);
    const bChild = childrenB.find(b => b.name === c.name);
    const refsB = bChild ? refsMap.get(bChild.id) : undefined;
    const refHintA = formatRefHint(refs);
    const refHintB = formatRefHint(refsB);
    if (refHintA || refHintB) {
      const aLabel = refHintA || '?';
      const bLabel = refHintB || '?';
      if (aLabel === bLabel) {
        lines.push(`- ${c.name}() → ${aLabel}`);
      } else {
        lines.push(`- ${c.name}() → A: ${aLabel} | B: ${bLabel}`);
      }
    } else {
      lines.push(`- ${c.name}()`);
    }
  }

  return lines.join('\n');
}

function formatChild(c: SymbolRecord, refs?: ReferenceRecord[]): string {
  const sig = c.signature ? ` → ${c.signature}` : '';
  const vis = c.visibility ? `${c.visibility} ` : '';
  const refHint = formatRefHint(refs);
  const refSuffix = refHint ? ` → ${refHint}` : '';
  return `- ${vis}${c.name}${sig}${refSuffix} (line ${c.lineStart})`;
}

function formatRefHint(refs?: ReferenceRecord[]): string | null {
  if (!refs || refs.length === 0) return null;
  // Show class_reference targets (the return Foo::class pattern)
  const classRefs = refs.filter(r => r.referenceKind === 'class_reference');
  if (classRefs.length > 0) {
    return classRefs.map(r => r.targetQualifiedName).join(', ');
  }
  return null;
}

async function resolveSymbol(
  repoId: number,
  name: string,
  symbolRepo: ToolDeps['symbolRepo']
): Promise<SymbolRecord | null> {
  // Try exact match first
  const exact = await symbolRepo.findByQualifiedName(repoId, name);
  if (exact) return exact;

  // Suffix fallback
  const escapedName = name.replace(/\\/g, '\\\\');
  const results = await symbolRepo.search(repoId, `%${escapedName}`, undefined, 1);
  return results.length > 0 ? results[0] : null;
}

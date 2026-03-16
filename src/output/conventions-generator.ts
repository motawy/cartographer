import type { ConventionsData } from './generate-pipeline.js';

const TOKEN_BUDGET_CHARS = 8000; // ~2K tokens

export function generateConventions(data: ConventionsData): string {
  const lines: string[] = [];

  lines.push('# Conventions\n');
  lines.push('Patterns detected from the indexed codebase. Stats are derived from actual code, not inferred.\n');

  // Symbol composition
  lines.push('## Symbol Composition\n');
  lines.push(`- **Classes:** ${data.totalClasses}`);
  lines.push(`- **Interfaces:** ${data.totalInterfaces}`);
  lines.push(`- **Traits:** ${data.totalTraits}`);
  if (data.totalEnums > 0) lines.push(`- **Enums:** ${data.totalEnums}`);
  lines.push('');

  // Structural patterns
  lines.push('## Structural Patterns\n');

  if (data.totalClasses > 0) {
    const implPct = pct(data.classesWithInterface, data.totalClasses);
    const inheritPct = pct(data.classesWithInheritance, data.totalClasses);
    const traitPct = pct(data.classesWithTraits, data.totalClasses);

    lines.push(`- **${implPct}%** of classes implement at least one interface (${data.classesWithInterface}/${data.totalClasses})`);
    lines.push(`- **${inheritPct}%** of classes extend another class (${data.classesWithInheritance}/${data.totalClasses})`);
    lines.push(`- **${traitPct}%** of classes use at least one trait (${data.classesWithTraits}/${data.totalClasses})`);
    lines.push('');
  }

  // Interface adoption by module
  if (data.interfaceAdoptionByModule.size > 0) {
    lines.push('## Interface Adoption by Module\n');
    lines.push('| Module | Classes | With Interface | Rate |');
    lines.push('|--------|---------|---------------|------|');

    const sorted = [...data.interfaceAdoptionByModule.entries()]
      .filter(([, v]) => v.total >= 3)
      .sort((a, b) => b[1].total - a[1].total);

    for (const [mod, stats] of sorted.slice(0, 20)) {
      const rate = pct(stats.withInterface, stats.total);
      lines.push(`| ${mod} | ${stats.total} | ${stats.withInterface} | ${rate}% |`);
    }
    lines.push('');
  }

  // Naming conventions
  lines.push('## Naming Conventions\n');

  if (data.classNames.length > 0) {
    const pascalCount = data.classNames.filter(n => /^[A-Z][a-zA-Z0-9]*$/.test(n)).length;
    const pascalPct = pct(pascalCount, data.classNames.length);
    lines.push(`- **Class naming:** ${pascalPct}% PascalCase (sample of ${data.classNames.length})`);
  }

  if (data.methodNames.length > 0) {
    // Filter out any magic methods that slipped through
    const nonMagic = data.methodNames.filter(n => !n.startsWith('__'));
    if (nonMagic.length > 0) {
      const camelCount = nonMagic.filter(n => /^[a-z][a-zA-Z0-9]*$/.test(n)).length;
      const snakeCount = nonMagic.filter(n => /^[a-z][a-z0-9_]*$/.test(n) && n.includes('_')).length;
      const camelPct = pct(camelCount, nonMagic.length);
      const snakePct = pct(snakeCount, nonMagic.length);

      if (camelPct > 0 && snakePct > 0) {
        lines.push(`- **Method naming:** ${camelPct}% camelCase, ${snakePct}% snake_case (sample of ${nonMagic.length})`);
      } else if (camelPct > 0) {
        lines.push(`- **Method naming:** ${camelPct}% camelCase (sample of ${nonMagic.length})`);
      } else if (snakePct > 0) {
        lines.push(`- **Method naming:** ${snakePct}% snake_case (sample of ${nonMagic.length})`);
      } else {
        const pascalCount = nonMagic.filter(n => /^[A-Z][a-zA-Z0-9]*$/.test(n)).length;
        const pascalPct = pct(pascalCount, nonMagic.length);
        lines.push(`- **Method naming:** PascalCase dominant — ${pascalPct}% PascalCase, 0% camelCase, 0% snake_case (sample of ${nonMagic.length})`);
      }
    }
  }

  lines.push('');

  let result = lines.join('\n');
  if (result.length > TOKEN_BUDGET_CHARS) {
    result = result.substring(0, TOKEN_BUDGET_CHARS) + '\n\n... (truncated to fit token budget)\n';
  }

  return result;
}

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

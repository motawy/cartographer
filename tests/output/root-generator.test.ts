import { describe, it, expect } from 'vitest';
import { generateRoot } from '../../src/output/root-generator.js';
import type { RepoStats } from '../../src/output/generate-pipeline.js';

function makeStats(overrides: Partial<RepoStats> = {}): RepoStats {
  return {
    totalFiles: 100,
    totalSymbols: 500,
    totalReferences: 200,
    language: 'php',
    directories: [
      { path: 'app/Models', fileCount: 10, symbolCount: 50, classCount: 10, dominantKinds: ['class'] },
      { path: 'app/Services', fileCount: 8, symbolCount: 40, classCount: 8, dominantKinds: ['class'] },
      { path: 'app/Repositories', fileCount: 6, symbolCount: 30, classCount: 6, dominantKinds: ['class'] },
      { path: 'app/Http', fileCount: 12, symbolCount: 60, classCount: 12, dominantKinds: ['class'] },
    ],
    ...overrides,
  };
}

describe('generateRoot', () => {
  it('includes project overview with stats', () => {
    const result = generateRoot(makeStats());
    expect(result).toContain('**Language:** Php');
    expect(result).toContain('**Files:** 100');
    expect(result).toContain('**Symbols:** 500');
  });

  it('detects architecture from directory names', () => {
    const result = generateRoot(makeStats());
    expect(result).toContain('service layer');
    expect(result).toContain('repository pattern');
  });

  it('includes directory map', () => {
    const result = generateRoot(makeStats());
    expect(result).toContain('app/Models');
    expect(result).toContain('app/Services');
    expect(result).toContain('symbols');
  });

  it('includes context file links', () => {
    const result = generateRoot(makeStats());
    expect(result).toContain('[Modules](modules.md)');
    expect(result).toContain('[Dependencies](dependencies.md)');
    expect(result).toContain('[Conventions](conventions.md)');
  });

  it('truncates directory map for large codebases', () => {
    const dirs = Array.from({ length: 50 }, (_, i) => ({
      path: `dir/module${i}`,
      fileCount: 5,
      symbolCount: 20,
      classCount: 5,
      dominantKinds: ['class'] as string[],
    }));
    const result = generateRoot(makeStats({ directories: dirs }));
    expect(result).toContain('... and 20 more directories');
  });

  it('handles unknown architecture gracefully', () => {
    const result = generateRoot(makeStats({
      directories: [
        { path: 'lib/foo', fileCount: 5, symbolCount: 20, classCount: 5, dominantKinds: ['class'] },
      ],
    }));
    expect(result).toContain('Architecture pattern could not be determined');
  });
});

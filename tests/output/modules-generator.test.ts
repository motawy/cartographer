import { describe, it, expect } from 'vitest';
import { generateModules } from '../../src/output/modules-generator.js';
import type { ModuleInfo } from '../../src/output/generate-pipeline.js';

function makeModules(count = 3, symbolsPerModule = 5): ModuleInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `app/Module${i}`,
    fileCount: symbolsPerModule, // multiple files = not standalone
    symbols: Array.from({ length: symbolsPerModule }, (_, j) => ({
      qualifiedName: `App\\Module${i}\\Class${j}`,
      kind: 'class',
      linesOfCode: 50,
      implements: j === 0 ? [`App\\Contracts\\Interface${i}`] : [],
      extends: j === 1 ? `App\\Base\\BaseClass` : null,
      traits: [],
      referenceCount: 10 - j,
    })),
  }));
}

describe('generateModules', () => {
  it('groups symbols by module', () => {
    const result = generateModules(makeModules());
    expect(result).toContain('## app/Module0');
    expect(result).toContain('## app/Module1');
    expect(result).toContain('## app/Module2');
  });

  it('shows symbol count per module', () => {
    const result = generateModules(makeModules(1, 8));
    expect(result).toContain('8 symbols');
  });

  it('formats relationships', () => {
    const result = generateModules(makeModules());
    expect(result).toContain('impl Interface0');
    expect(result).toContain('extends BaseClass');
  });

  it('shows reference counts', () => {
    const result = generateModules(makeModules(1, 3));
    expect(result).toContain('| Class0 | class | 10 |');
  });

  it('truncates large modules', () => {
    const result = generateModules(makeModules(1, 25));
    expect(result).toContain('... and 10 more');
  });

  it('truncates many modules', () => {
    const result = generateModules(makeModules(50, 2));
    expect(result).toContain('... and 10 more modules');
  });

  it('renders single-file modules in standalone section', () => {
    const modules: ModuleInfo[] = [
      {
        path: 'app/Services',
        fileCount: 5,
        symbols: [{ qualifiedName: 'App\\Services\\UserService', kind: 'class', linesOfCode: 100, implements: [], extends: null, traits: [], referenceCount: 10 }],
      },
      {
        path: 'objects/PermissionFunctions.php',
        fileCount: 1,
        symbols: Array.from({ length: 20 }, (_, i) => ({
          qualifiedName: `PermissionFunctions::method${i}`,
          kind: 'class',
          linesOfCode: 10,
          implements: [],
          extends: null,
          traits: [],
          referenceCount: 5 - (i % 5),
        })),
      },
    ];
    const result = generateModules(modules);
    expect(result).toContain('## Standalone Files');
    expect(result).toContain('| objects/PermissionFunctions.php |');
    // Should NOT appear as a regular module heading
    expect(result).not.toContain('## objects/PermissionFunctions.php (');
  });

  it('limits standalone files to 10', () => {
    const modules: ModuleInfo[] = Array.from({ length: 15 }, (_, i) => ({
      path: `objects/File${i}.php`,
      fileCount: 1,
      symbols: [{ qualifiedName: `File${i}`, kind: 'class', linesOfCode: 50, implements: [], extends: null, traits: [], referenceCount: 0 }],
    }));
    const result = generateModules(modules);
    expect(result).toContain('... and 5 more');
  });

  it('renders test modules as summary line', () => {
    const modules: ModuleInfo[] = [
      {
        path: 'app/Services',
        fileCount: 5,
        symbols: [{ qualifiedName: 'App\\Services\\UserService', kind: 'class', linesOfCode: 100, implements: [], extends: null, traits: [], referenceCount: 10 }],
      },
      {
        path: 'tests/objects',
        fileCount: 50,
        symbols: Array.from({ length: 100 }, (_, i) => ({
          qualifiedName: `Tests\\Objects\\Test${i}`,
          kind: 'class',
          linesOfCode: 30,
          implements: [],
          extends: null,
          traits: [],
          referenceCount: 0,
        })),
      },
    ];
    const result = generateModules(modules);
    expect(result).toContain('**Test suite:**');
    expect(result).toContain('100');
    expect(result).toContain('tests/objects');
    // Should NOT appear as a regular module heading
    expect(result).not.toContain('## tests/objects');
  });
});

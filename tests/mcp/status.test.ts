import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { ReferenceRepository } from '../../src/db/repositories/reference-repository.js';
import { handleStatus } from '../../src/mcp/tools/status.js';
import type { ParsedSymbol } from '../../src/types.js';

describe('cartograph_status', () => {
  it('reports additional sources and unresolved trust breakdown', () => {
    const db = openDatabase({ path: ':memory:' });

    try {
      runMigrations(db);

      const repoRepo = new RepoRepository(db);
      const fileRepo = new FileRepository(db);
      const symbolRepo = new SymbolRepository(db);
      const refRepo = new ReferenceRepository(db);

      const repo = repoRepo.findOrCreate('/test/repo', 'test');
      repoRepo.updateLastIndexed(repo.id);

      const appFile = fileRepo.upsert(repo.id, 'src/Foo.php', 'php', 'h1', 10);
      const barFile = fileRepo.upsert(repo.id, 'src/Bar.php', 'php', 'h2', 10);
      const testFile = fileRepo.upsert(repo.id, 'tests/FooTest.php', 'php', 'h3', 10);
      const cacheFile = fileRepo.upsert(repo.id, 'cache/Container.php', 'php', 'h4', 10);
      fileRepo.upsert(repo.id, '@shared/BaseThing.php', 'php', 'h5', 10);

      const fooSymbol: ParsedSymbol = {
        name: 'Foo',
        qualifiedName: 'App\\Foo',
        kind: 'class',
        visibility: null,
        lineStart: 1,
        lineEnd: 10,
        signature: null,
        returnType: null,
        docblock: null,
        children: [],
        metadata: {},
      };
      const barSymbol: ParsedSymbol = {
        name: 'Bar',
        qualifiedName: 'App\\Bar',
        kind: 'class',
        visibility: null,
        lineStart: 1,
        lineEnd: 10,
        signature: null,
        returnType: null,
        docblock: null,
        children: [],
        metadata: {},
      };
      const testSymbol: ParsedSymbol = {
        name: 'FooTest',
        qualifiedName: 'Tests\\FooTest',
        kind: 'class',
        visibility: null,
        lineStart: 1,
        lineEnd: 10,
        signature: null,
        returnType: null,
        docblock: null,
        children: [],
        metadata: {},
      };
      const cacheSymbol: ParsedSymbol = {
        name: 'Container',
        qualifiedName: 'Container\\Generated',
        kind: 'class',
        visibility: null,
        lineStart: 1,
        lineEnd: 10,
        signature: null,
        returnType: null,
        docblock: null,
        children: [],
        metadata: {},
      };

      const fooMap = symbolRepo.replaceFileSymbols(appFile.id, [fooSymbol]);
      symbolRepo.replaceFileSymbols(barFile.id, [barSymbol]);
      const testMap = symbolRepo.replaceFileSymbols(testFile.id, [testSymbol]);
      const cacheMap = symbolRepo.replaceFileSymbols(cacheFile.id, [cacheSymbol]);

      refRepo.replaceFileReferences(appFile.id, fooMap, [
        { sourceQualifiedName: 'App\\Foo', targetQualifiedName: 'App\\Bar', kind: 'type_hint', line: 2 },
        { sourceQualifiedName: 'App\\Foo', targetQualifiedName: 'Symfony\\Component\\HttpFoundation\\Request', kind: 'type_hint', line: 3 },
        { sourceQualifiedName: 'App\\Foo', targetQualifiedName: 'DateTime', kind: 'instantiation', line: 4 },
        { sourceQualifiedName: 'App\\Foo', targetQualifiedName: 'SystemConfig', kind: 'instantiation', line: 5 },
      ]);
      refRepo.replaceFileReferences(testFile.id, testMap, [
        { sourceQualifiedName: 'Tests\\FooTest', targetQualifiedName: 'Phake::mock', kind: 'static_call', line: 6 },
      ]);
      refRepo.replaceFileReferences(cacheFile.id, cacheMap, [
        { sourceQualifiedName: 'Container\\Generated', targetQualifiedName: 'Symfony\\Component\\HttpFoundation\\Request', kind: 'type_hint', line: 7 },
      ]);
      refRepo.resolveTargets(repo.id);

      const result = handleStatus({ db, repoId: repo.id });

      expect(result).toContain('Additional sources: shared (1 files)');
      expect(result).toContain('Raw resolution rate: 17%');
      expect(result).toContain('Production trust rate: 75% (potential internal/cross-repo gaps: 1)');
      expect(result).toContain('Potential internal / cross-repo gaps: 1 (20%)');
      expect(result).toContain('PHP builtins: 1 (20%)');
      expect(result).toContain('External vendor / framework: 1 (20%)');
      expect(result).toContain('Test framework / mocks: 1 (20%)');
      expect(result).toContain('Generated cache: 1 (20%)');
    } finally {
      db.close();
    }
  });
});

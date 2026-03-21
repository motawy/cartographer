import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { ReferenceRepository } from '../../src/db/repositories/reference-repository.js';
import { renderStatusForRepo } from '../../src/cli/status.js';
import type { ParsedSymbol } from '../../src/types.js';

describe('renderStatusForRepo', () => {
  it('renders status for an indexed repo path', () => {
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

      const fooMap = symbolRepo.replaceFileSymbols(appFile.id, [fooSymbol]);
      symbolRepo.replaceFileSymbols(barFile.id, [barSymbol]);
      refRepo.replaceFileReferences(appFile.id, fooMap, [
        { sourceQualifiedName: 'App\\Foo', targetQualifiedName: 'App\\Bar', kind: 'type_hint', line: 2 },
      ]);
      refRepo.resolveTargets(repo.id);

      const result = renderStatusForRepo(db, '/test/repo');

      expect(result).toContain('## Cartograph Index Status');
      expect(result).toContain('Repository: test (/test/repo)');
      expect(result).toContain('Files: 2');
      expect(result).toContain('References: 1 (1 resolved, 0 unresolved)');
    } finally {
      db.close();
    }
  });

  it('throws when the repo has not been indexed', () => {
    const db = openDatabase({ path: ':memory:' });

    try {
      runMigrations(db);

      expect(() => renderStatusForRepo(db, '/missing/repo')).toThrow(
        'No index found for /missing/repo. Run `cartograph index` first.'
      );
    } finally {
      db.close();
    }
  });
});

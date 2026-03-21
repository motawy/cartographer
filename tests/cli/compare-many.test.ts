import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { renderCompareManyForRepo } from '../../src/cli/compare-many.js';
import type { ParsedSymbol } from '../../src/types.js';

describe('renderCompareManyForRepo', () => {
  it('renders compare-many summaries for an indexed repo', () => {
    const db = openDatabase({ path: ':memory:' });

    try {
      runMigrations(db);
      const repoRepo = new RepoRepository(db);
      const fileRepo = new FileRepository(db);
      const symbolRepo = new SymbolRepository(db);
      const repo = repoRepo.findOrCreate('/test/repo', 'test');
      const fileA = fileRepo.upsert(repo.id, 'a.php', 'php', 'ha', 10);
      const fileB = fileRepo.upsert(repo.id, 'b.php', 'php', 'hb', 10);

      const baseline: ParsedSymbol = {
        name: 'A',
        qualifiedName: 'App\\A',
        kind: 'class',
        visibility: null,
        lineStart: 1,
        lineEnd: 10,
        signature: null,
        returnType: null,
        docblock: null,
        metadata: {},
        children: [
          {
            name: 'foo',
            qualifiedName: 'App\\A::foo',
            kind: 'method',
            visibility: 'public',
            lineStart: 3,
            lineEnd: 5,
            signature: null,
            returnType: null,
            docblock: null,
            metadata: {},
            children: [],
          },
        ],
      };

      const target: ParsedSymbol = {
        name: 'B',
        qualifiedName: 'App\\B',
        kind: 'class',
        visibility: null,
        lineStart: 1,
        lineEnd: 10,
        signature: null,
        returnType: null,
        docblock: null,
        metadata: {},
        children: [],
      };

      symbolRepo.replaceFileSymbols(fileA.id, [baseline]);
      symbolRepo.replaceFileSymbols(fileB.id, [target]);

      const result = renderCompareManyForRepo(db, '/test/repo', 'App\\A', ['App\\B']);
      expect(result).toContain('Compare Many');
      expect(result).toContain('Missing from target compared to baseline (1): foo');
    } finally {
      db.close();
    }
  });
});

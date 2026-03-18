import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { ReferenceRepository } from '../../src/db/repositories/reference-repository.js';
import { handleFind } from '../../src/mcp/tools/find.js';
import type { ToolDeps } from '../../src/mcp/types.js';
import type { ParsedSymbol } from '../../src/types.js';

function makeClass(name: string, qn: string): ParsedSymbol {
  return {
    name, qualifiedName: qn, kind: 'class', visibility: null,
    lineStart: 1, lineEnd: 10, signature: null, returnType: null,
    docblock: null, children: [], metadata: {},
  };
}

describe('cartograph_find', () => {
  let db: Database.Database;
  let deps: ToolDeps;
  let repoId: number;

  beforeAll(() => {
    db = openDatabase({ path: ':memory:' });
    runMigrations(db);
    const repoRepo = new RepoRepository(db);
    const fileRepo = new FileRepository(db);
    const symbolRepo = new SymbolRepository(db);
    const refRepo = new ReferenceRepository(db);

    const repo = repoRepo.findOrCreate('/test/repo', 'test');
    repoId = repo.id;

    const f1 = fileRepo.upsert(repoId, 'app/Services/UserService.php', 'php', 'h1', 40);
    const f2 = fileRepo.upsert(repoId, 'app/Models/User.php', 'php', 'h2', 30);
    const f3 = fileRepo.upsert(repoId, 'app/Services/OrderService.php', 'php', 'h3', 20);

    symbolRepo.replaceFileSymbols(f1.id, [makeClass('UserService', 'App\\Services\\UserService')]);
    symbolRepo.replaceFileSymbols(f2.id, [makeClass('User', 'App\\Models\\User')]);
    symbolRepo.replaceFileSymbols(f3.id, [makeClass('OrderService', 'App\\Services\\OrderService')]);

    deps = { repoId, symbolRepo, refRepo };
  });

  afterAll(() => {
    db.close();
  });

  it('finds symbols by substring', () => {
    const result = handleFind(deps, { query: 'Service' });
    expect(result).toContain('UserService');
    expect(result).toContain('OrderService');
    expect(result).toContain('## Search:');
    expect(result).toContain('Found');
  });

  it('finds symbols by wildcard pattern', () => {
    const result = handleFind(deps, { query: 'App\\Services\\*' });
    expect(result).toContain('UserService');
    expect(result).toContain('OrderService');
  });

  it('filters by kind', () => {
    const result = handleFind(deps, { query: 'User', kind: 'class' });
    expect(result).toContain('class');
  });

  it('respects limit', () => {
    const result = handleFind(deps, { query: '%', limit: 1 });
    // Should contain exactly 1 table row (after header row)
    const tableRows = result.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Symbol'));
    expect(tableRows).toHaveLength(1);
  });

  it('returns no-results message', () => {
    const result = handleFind(deps, { query: 'Nonexistent' });
    expect(result).toContain('No symbols found');
  });

  it('filters by file path', () => {
    const result = handleFind(deps, { query: '%', path: 'app/Services' });
    expect(result).toContain('UserService');
    expect(result).toContain('OrderService');
    expect(result).not.toContain('App\\Models\\User'); // User is in app/Models, not app/Services
  });

  it('matches partial path (substring, not just prefix)', () => {
    // "Services" is in the middle of the path, not the start
    const result = handleFind(deps, { query: '%', path: 'Services' });
    expect(result).toContain('UserService');
    expect(result).toContain('OrderService');
    expect(result).not.toContain('App\\Models\\User');
  });

  it('suggests paths when path filter returns 0 results', () => {
    const result = handleFind(deps, { query: 'User', path: 'Nonexistent' });
    expect(result).toContain('No symbols found');
    expect(result).toContain('No files match that path fragment');
  });

  it('suggests similar paths when partial match exists but no symbols match', () => {
    // Path exists but query doesn't match any symbols in it
    const result = handleFind(deps, { query: 'Nonexistent', path: 'Services' });
    expect(result).toContain('No symbols found');
    expect(result).toContain('Did you mean');
    expect(result).toContain('app/Services');
  });
});

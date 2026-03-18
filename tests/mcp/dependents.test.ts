import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { ReferenceRepository } from '../../src/db/repositories/reference-repository.js';
import { handleDependents } from '../../src/mcp/tools/dependents.js';
import type { ToolDeps } from '../../src/mcp/types.js';
import type { ParsedSymbol } from '../../src/types.js';

describe('cartograph_dependents', () => {
  let db: Database.Database;
  let deps: ToolDeps;

  beforeAll(() => {
    db = openDatabase({ path: ':memory:' });
    runMigrations(db);
    const repoRepo = new RepoRepository(db);
    const fileRepo = new FileRepository(db);
    const symbolRepo = new SymbolRepository(db);
    const refRepo = new ReferenceRepository(db);

    const repo = repoRepo.findOrCreate('/test/repo', 'test');
    const f1 = fileRepo.upsert(repo.id, 'app/Controllers/UserController.php', 'php', 'h1', 30);
    const f2 = fileRepo.upsert(repo.id, 'app/Services/UserService.php', 'php', 'h2', 40);
    const f3 = fileRepo.upsert(repo.id, 'app/Repositories/UserRepository.php', 'php', 'h3', 20);

    const mkClass = (name: string, qn: string): ParsedSymbol => ({
      name, qualifiedName: qn, kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 10, signature: null, returnType: null,
      docblock: null, children: [], metadata: {},
    });

    const ids1 = symbolRepo.replaceFileSymbols(f1.id, [mkClass('UserController', 'App\\Controllers\\UserController')]);
    const ids2 = symbolRepo.replaceFileSymbols(f2.id, [mkClass('UserService', 'App\\Services\\UserService')]);
    symbolRepo.replaceFileSymbols(f3.id, [mkClass('UserRepository', 'App\\Repositories\\UserRepository')]);

    // Controller → Service, Service → Repository
    refRepo.replaceFileReferences(f1.id, ids1, [
      { sourceQualifiedName: 'App\\Controllers\\UserController', targetQualifiedName: 'app\\services\\userservice', kind: 'instantiation', line: 12 },
    ]);
    refRepo.replaceFileReferences(f2.id, ids2, [
      { sourceQualifiedName: 'App\\Services\\UserService', targetQualifiedName: 'app\\repositories\\userrepository', kind: 'instantiation', line: 13 },
    ]);
    refRepo.resolveTargets(repo.id);

    deps = { repoId: repo.id, symbolRepo, refRepo };
  });

  afterAll(() => {
    db.close();
  });

  it('shows immediate dependents at depth 1', () => {
    const result = handleDependents(deps, { symbol: 'App\\Repositories\\UserRepository', depth: 1 });
    expect(result).toContain('App\\Services\\UserService');
    expect(result).not.toContain('App\\Controllers\\UserController');
  });

  it('shows transitive dependents at depth 2', () => {
    const result = handleDependents(deps, { symbol: 'App\\Repositories\\UserRepository', depth: 2 });
    expect(result).toContain('App\\Services\\UserService');
    expect(result).toContain('App\\Controllers\\UserController');
  });

  it('groups by file path', () => {
    const result = handleDependents(deps, { symbol: 'App\\Repositories\\UserRepository', depth: 2 });
    expect(result).toContain('app/Services/UserService.php');
    expect(result).toContain('app/Controllers/UserController.php');
  });

  it('returns no-dependents message', () => {
    const result = handleDependents(deps, { symbol: 'App\\Controllers\\UserController' });
    expect(result).toContain('No dependents');
  });

  it('returns not-found for unknown symbol', () => {
    const result = handleDependents(deps, { symbol: 'App\\Nonexistent' });
    expect(result).toContain('not found');
  });
});

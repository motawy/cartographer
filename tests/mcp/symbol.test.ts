import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { ReferenceRepository } from '../../src/db/repositories/reference-repository.js';
import { handleSymbol } from '../../src/mcp/tools/symbol.js';
import type { ToolDeps, RepoStats } from '../../src/mcp/types.js';
import type { ParsedSymbol } from '../../src/types.js';

const TEST_DB = {
  host: 'localhost', port: 5435,
  database: 'cartograph_test', user: 'cartograph', password: 'localdev',
};

describe('cartograph_symbol', () => {
  let pool: pg.Pool;
  let deps: ToolDeps;
  let stats: RepoStats;

  beforeAll(async () => {
    pool = new pg.Pool(TEST_DB);
    const repoRepo = new RepoRepository(pool);
    const fileRepo = new FileRepository(pool);
    const symbolRepo = new SymbolRepository(pool);
    const refRepo = new ReferenceRepository(pool);

    await pool.query('DELETE FROM symbol_references');
    await pool.query('DELETE FROM symbols');
    await pool.query('DELETE FROM files');
    await pool.query('DELETE FROM repos');

    const repo = await repoRepo.findOrCreate('/test/repo', 'test');

    const f1 = await fileRepo.upsert(repo.id, 'app/Services/UserService.php', 'php', 'h1', 40);
    const f2 = await fileRepo.upsert(repo.id, 'app/Contracts/UserServiceInterface.php', 'php', 'h2', 10);
    const f3 = await fileRepo.upsert(repo.id, 'app/Repositories/UserRepository.php', 'php', 'h3', 20);

    const svcSymbol: ParsedSymbol = {
      name: 'UserService', qualifiedName: 'App\\Services\\UserService',
      kind: 'class', visibility: null, lineStart: 9, lineEnd: 39,
      signature: null, returnType: null, docblock: null, metadata: {},
      children: [{
        name: 'findById', qualifiedName: 'App\\Services\\UserService::findById',
        kind: 'method', visibility: 'public', lineStart: 21, lineEnd: 24,
        signature: 'findById(int $id): ?User', returnType: '?User',
        docblock: null, children: [], metadata: {},
      }],
    };
    const ifaceSymbol: ParsedSymbol = {
      name: 'UserServiceInterface', qualifiedName: 'App\\Contracts\\UserServiceInterface',
      kind: 'interface', visibility: null, lineStart: 10, lineEnd: 17,
      signature: null, returnType: null, docblock: null, children: [], metadata: {},
    };
    const repoSymbol: ParsedSymbol = {
      name: 'UserRepository', qualifiedName: 'App\\Repositories\\UserRepository',
      kind: 'class', visibility: null, lineStart: 7, lineEnd: 29,
      signature: null, returnType: null, docblock: null, children: [], metadata: {},
    };

    const ids1 = await symbolRepo.replaceFileSymbols(f1.id, [svcSymbol]);
    const ids2 = await symbolRepo.replaceFileSymbols(f2.id, [ifaceSymbol]);
    const ids3 = await symbolRepo.replaceFileSymbols(f3.id, [repoSymbol]);

    // Add references: UserService implements UserServiceInterface, instantiates UserRepository
    await refRepo.replaceFileReferences(f1.id, ids1, [
      { sourceQualifiedName: 'App\\Services\\UserService', targetQualifiedName: 'app\\contracts\\userserviceinterface', kind: 'implementation', line: 9 },
      { sourceQualifiedName: 'App\\Services\\UserService', targetQualifiedName: 'app\\repositories\\userrepository', kind: 'instantiation', line: 13 },
    ]);
    await refRepo.resolveTargets(repo.id);

    deps = { repoId: repo.id, symbolRepo, refRepo };
    stats = { totalClasses: 2, classesWithInterface: 1, classesWithBaseClass: 0, classesWithTraits: 0 };
  });

  afterAll(async () => {
    await pool.end();
  });

  it('finds symbol by exact qualified name', async () => {
    const result = await handleSymbol(deps, stats, { name: 'App\\Services\\UserService' });
    expect(result).toContain('App\\Services\\UserService');
    expect(result).toContain('class');
    expect(result).toContain('app/Services/UserService.php');
  });

  it('falls back to suffix match for short names', async () => {
    const result = await handleSymbol(deps, stats, { name: 'UserService' });
    expect(result).toContain('App\\Services\\UserService');
  });

  it('includes depends-on section', async () => {
    const result = await handleSymbol(deps, stats, { name: 'App\\Services\\UserService' });
    expect(result).toContain('Depends on');
    expect(result).toContain('implementation');
  });

  it('includes used-by section when dependents exist', async () => {
    const result = await handleSymbol(deps, stats, { name: 'App\\Contracts\\UserServiceInterface' });
    expect(result).toContain('Used by');
  });

  it('includes conventions context for classes', async () => {
    const result = await handleSymbol(deps, stats, { name: 'App\\Services\\UserService' });
    expect(result).toContain('Context:');
    // Should mention interface implementation since UserService implements one
    expect(result).toMatch(/[Ii]mplements/);
  });

  it('returns not-found message', async () => {
    const result = await handleSymbol(deps, stats, { name: 'Nonexistent' });
    expect(result).toContain('not found');
    expect(result).toContain('cartograph_find');
  });
});

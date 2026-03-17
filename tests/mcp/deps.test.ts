import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { ReferenceRepository } from '../../src/db/repositories/reference-repository.js';
import { handleDeps } from '../../src/mcp/tools/deps.js';
import type { ToolDeps } from '../../src/mcp/types.js';
import type { ParsedSymbol } from '../../src/types.js';

const TEST_DB = {
  host: 'localhost', port: 5435,
  database: 'cartograph_test', user: 'cartograph', password: 'localdev',
};

describe('cartograph_deps', () => {
  let pool: pg.Pool;
  let deps: ToolDeps;

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
    const f1 = await fileRepo.upsert(repo.id, 'a.php', 'php', 'h1', 10);
    const f2 = await fileRepo.upsert(repo.id, 'b.php', 'php', 'h2', 10);
    const f3 = await fileRepo.upsert(repo.id, 'c.php', 'php', 'h3', 10);

    const mkClass = (name: string, qn: string): ParsedSymbol => ({
      name, qualifiedName: qn, kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 10, signature: null, returnType: null,
      docblock: null, children: [], metadata: {},
    });

    const ids1 = await symbolRepo.replaceFileSymbols(f1.id, [mkClass('A', 'Ns\\A')]);
    const ids2 = await symbolRepo.replaceFileSymbols(f2.id, [mkClass('B', 'Ns\\B')]);
    const ids3 = await symbolRepo.replaceFileSymbols(f3.id, [mkClass('C', 'Ns\\C')]);

    // A → B (resolved), A → External (unresolved), B → C (resolved)
    await refRepo.replaceFileReferences(f1.id, ids1, [
      { sourceQualifiedName: 'Ns\\A', targetQualifiedName: 'ns\\b', kind: 'instantiation', line: 5 },
      { sourceQualifiedName: 'Ns\\A', targetQualifiedName: 'external\\lib', kind: 'static_call', line: 7 },
    ]);
    await refRepo.replaceFileReferences(f2.id, ids2, [
      { sourceQualifiedName: 'Ns\\B', targetQualifiedName: 'ns\\c', kind: 'instantiation', line: 3 },
    ]);
    await refRepo.resolveTargets(repo.id);

    deps = { repoId: repo.id, symbolRepo, refRepo };
  });

  afterAll(async () => {
    await pool.end();
  });

  it('shows immediate dependencies at depth 1', async () => {
    const result = await handleDeps(deps, { symbol: 'Ns\\A', depth: 1 });
    expect(result).toContain('Ns\\B');
    expect(result).not.toContain('Ns\\C'); // C is depth 2
  });

  it('shows transitive dependencies at depth 3', async () => {
    const result = await handleDeps(deps, { symbol: 'Ns\\A', depth: 3 });
    expect(result).toContain('Ns\\B');
    expect(result).toContain('Ns\\C');
  });

  it('shows unresolved references', async () => {
    const result = await handleDeps(deps, { symbol: 'Ns\\A', depth: 1 });
    expect(result).toContain('external\\lib');
    expect(result).toContain('unresolved');
  });

  it('returns not-found for unknown symbol', async () => {
    const result = await handleDeps(deps, { symbol: 'Ns\\Z' });
    expect(result).toContain('not found');
  });
});

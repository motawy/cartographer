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

  it('follows class_reference edges at depth > 0', async () => {
    // Setup: D → E (instantiation, depth 0), E → F (class_reference, depth 1)
    // This mimics Route → Builder wiring via return Builder::class
    const repoRepo = new RepoRepository(pool);
    const fileRepo = new FileRepository(pool);
    const symbolRepo = new SymbolRepository(pool);
    const refRepo = new ReferenceRepository(pool);

    const repo = await repoRepo.findOrCreate('/test/class-ref-repo', 'test-classref');
    const fd = await fileRepo.upsert(repo.id, 'route.php', 'php', 'hd', 10);
    const fe = await fileRepo.upsert(repo.id, 'controller.php', 'php', 'he', 10);
    const ff = await fileRepo.upsert(repo.id, 'builder.php', 'php', 'hf', 10);

    const mkClass = (name: string, qn: string): ParsedSymbol => ({
      name, qualifiedName: qn, kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 10, signature: null, returnType: null,
      docblock: null, children: [], metadata: {},
    });

    const idsD = await symbolRepo.replaceFileSymbols(fd.id, [mkClass('Route', 'App\\Route')]);
    const idsE = await symbolRepo.replaceFileSymbols(fe.id, [mkClass('Controller', 'App\\Controller')]);
    await symbolRepo.replaceFileSymbols(ff.id, [mkClass('Builder', 'App\\Builder')]);

    // Route → Controller (class_reference), Controller → Builder (class_reference)
    await refRepo.replaceFileReferences(fd.id, idsD, [
      { sourceQualifiedName: 'App\\Route', targetQualifiedName: 'app\\controller', kind: 'class_reference', line: 10 },
    ]);
    await refRepo.replaceFileReferences(fe.id, idsE, [
      { sourceQualifiedName: 'App\\Controller', targetQualifiedName: 'app\\builder', kind: 'class_reference', line: 15 },
    ]);
    await refRepo.resolveTargets(repo.id);

    const toolDeps: ToolDeps = { repoId: repo.id, symbolRepo, refRepo };
    const result = await handleDeps(toolDeps, { symbol: 'App\\Route', depth: 2 });

    // Route at depth 0 shows class_reference to Controller (always shown at depth 0)
    expect(result).toContain('App\\Controller');
    // Controller at depth 1 should ALSO follow class_reference to Builder
    expect(result).toContain('App\\Builder');
  });

  it('shows via context (method name + line) for child method refs', async () => {
    const repoRepo = new RepoRepository(pool);
    const fileRepo = new FileRepository(pool);
    const symbolRepo = new SymbolRepository(pool);
    const refRepo = new ReferenceRepository(pool);

    const repo = await repoRepo.findOrCreate('/test/via-context', 'test-via');
    const f1 = await fileRepo.upsert(repo.id, 'route.php', 'php', 'hv1', 30);
    const f2 = await fileRepo.upsert(repo.id, 'controller.php', 'php', 'hv2', 10);

    const ids1 = await symbolRepo.replaceFileSymbols(f1.id, [{
      name: 'MyRoute', qualifiedName: 'App\\MyRoute', kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 30, signature: null, returnType: null,
      docblock: null, metadata: {},
      children: [{
        name: 'getControllerName', qualifiedName: 'App\\MyRoute::getControllerName', kind: 'method',
        visibility: 'public', lineStart: 10, lineEnd: 13, signature: null, returnType: null,
        docblock: null, children: [], metadata: {},
      }],
    }]);
    await symbolRepo.replaceFileSymbols(f2.id, [{
      name: 'MyController', qualifiedName: 'App\\MyController', kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 10, signature: null, returnType: null,
      docblock: null, children: [], metadata: {},
    }]);

    await refRepo.replaceFileReferences(f1.id, ids1, [
      { sourceQualifiedName: 'App\\MyRoute::getControllerName', targetQualifiedName: 'app\\mycontroller', kind: 'class_reference', line: 12 },
    ]);
    await refRepo.resolveTargets(repo.id);

    const toolDeps: ToolDeps = { repoId: repo.id, symbolRepo, refRepo };
    const result = await handleDeps(toolDeps, { symbol: 'App\\MyRoute', depth: 1 });

    expect(result).toContain('App\\MyController');
    expect(result).toContain('via getControllerName()');
    expect(result).toContain('line 12');
  });
});

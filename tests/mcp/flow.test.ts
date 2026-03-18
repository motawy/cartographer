import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { ReferenceRepository } from '../../src/db/repositories/reference-repository.js';
import { handleFlow } from '../../src/mcp/tools/flow.js';
import type { ToolDeps } from '../../src/mcp/types.js';
import type { ParsedSymbol } from '../../src/types.js';

const TEST_DB = {
  host: 'localhost', port: 5435,
  database: 'cartograph_test', user: 'cartograph', password: 'localdev',
};

describe('cartograph_flow', () => {
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
    const f4 = await fileRepo.upsert(repo.id, 'd.php', 'php', 'h4', 10);

    const mkClass = (name: string, qn: string): ParsedSymbol => ({
      name, qualifiedName: qn, kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 10, signature: null, returnType: null,
      docblock: null, children: [], metadata: {},
    });

    const f5 = await fileRepo.upsert(repo.id, 'e.php', 'php', 'h5', 10);

    const ids1 = await symbolRepo.replaceFileSymbols(f1.id, [mkClass('A', 'Ns\\A')]);
    const ids2 = await symbolRepo.replaceFileSymbols(f2.id, [mkClass('B', 'Ns\\B')]);
    await symbolRepo.replaceFileSymbols(f3.id, [mkClass('C', 'Ns\\C')]);
    await symbolRepo.replaceFileSymbols(f4.id, [mkClass('Base', 'Ns\\Base')]);
    await symbolRepo.replaceFileSymbols(f5.id, [mkClass('E', 'Ns\\E')]);

    // A instantiates B (call), A inherits Base (structural — should be excluded)
    // B instantiates C (call), A references E via ::class (class_reference)
    await refRepo.replaceFileReferences(f1.id, ids1, [
      { sourceQualifiedName: 'Ns\\A', targetQualifiedName: 'ns\\b', kind: 'instantiation', line: 5 },
      { sourceQualifiedName: 'Ns\\A', targetQualifiedName: 'ns\\base', kind: 'inheritance', line: 1 },
      { sourceQualifiedName: 'Ns\\A', targetQualifiedName: 'ns\\e', kind: 'class_reference', line: 6 },
    ]);
    await refRepo.replaceFileReferences(f2.id, ids2, [
      { sourceQualifiedName: 'Ns\\B', targetQualifiedName: 'ns\\c', kind: 'static_call', line: 3 },
    ]);
    await refRepo.resolveTargets(repo.id);

    deps = { repoId: repo.id, symbolRepo, refRepo };
  });

  afterAll(async () => {
    await pool.end();
  });

  it('traces call flow excluding structural refs', async () => {
    const result = await handleFlow(deps, { symbol: 'Ns\\A', depth: 5 });
    expect(result).toContain('Ns\\B');
    expect(result).toContain('Ns\\C');
    // Structural ref (inheritance) should not appear in flow
    expect(result).not.toContain('Ns\\Base');
  });

  it('respects depth limit', async () => {
    const result = await handleFlow(deps, { symbol: 'Ns\\A', depth: 1 });
    expect(result).toContain('Ns\\B');
    expect(result).not.toContain('Ns\\C');
  });

  it('returns not-found for unknown symbol', async () => {
    const result = await handleFlow(deps, { symbol: 'Ns\\Z' });
    expect(result).toContain('not found');
  });

  it('follows class_reference edges', async () => {
    const result = await handleFlow(deps, { symbol: 'Ns\\A', depth: 5 });
    expect(result).toContain('Ns\\E');
  });

  it('traces through parent template methods to child overrides', async () => {
    // Setup: Route extends BaseRoute. BaseRoute::init calls $this->getControllerName().
    // Route::getControllerName returns Controller::class.
    // Flow should trace: Route → Controller (via init() → getControllerName())
    const repoRepo = new RepoRepository(pool);
    const fileRepo = new FileRepository(pool);
    const symbolRepo = new SymbolRepository(pool);
    const refRepo = new ReferenceRepository(pool);

    const repo = await repoRepo.findOrCreate('/test/template-flow', 'test-tpl');
    const fBase = await fileRepo.upsert(repo.id, 'baseroute.php', 'php', 'tb1', 50);
    const fRoute = await fileRepo.upsert(repo.id, 'route.php', 'php', 'tb2', 30);
    const fCtrl = await fileRepo.upsert(repo.id, 'controller.php', 'php', 'tb3', 10);

    // BaseRoute with init() method that self_calls getControllerName()
    const baseIds = await symbolRepo.replaceFileSymbols(fBase.id, [{
      name: 'BaseRoute', qualifiedName: 'App\\BaseRoute', kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 50, signature: null, returnType: null,
      docblock: null, metadata: {},
      children: [{
        name: 'init', qualifiedName: 'App\\BaseRoute::init', kind: 'method',
        visibility: 'public', lineStart: 10, lineEnd: 20, signature: null, returnType: null,
        docblock: null, children: [], metadata: {},
      }],
    }]);

    // Route with getControllerName() that returns Controller::class
    const routeIds = await symbolRepo.replaceFileSymbols(fRoute.id, [{
      name: 'MyRoute', qualifiedName: 'App\\MyRoute', kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 30, signature: null, returnType: null,
      docblock: null, metadata: {},
      children: [{
        name: 'getControllerName', qualifiedName: 'App\\MyRoute::getControllerName', kind: 'method',
        visibility: 'public', lineStart: 10, lineEnd: 13, signature: null, returnType: null,
        docblock: null, children: [], metadata: {},
      }],
    }]);

    await symbolRepo.replaceFileSymbols(fCtrl.id, [{
      name: 'MyController', qualifiedName: 'App\\MyController', kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 10, signature: null, returnType: null,
      docblock: null, children: [], metadata: {},
    }]);

    // BaseRoute::init self_calls BaseRoute::getControllerName
    await refRepo.replaceFileReferences(fBase.id, baseIds, [
      { sourceQualifiedName: 'App\\BaseRoute::init', targetQualifiedName: 'app\\baseroute::getcontrollername', kind: 'self_call', line: 15 },
    ]);

    // Route inherits BaseRoute, getControllerName has class_reference to Controller
    await refRepo.replaceFileReferences(fRoute.id, routeIds, [
      { sourceQualifiedName: 'App\\MyRoute', targetQualifiedName: 'app\\baseroute', kind: 'inheritance', line: 1 },
      { sourceQualifiedName: 'App\\MyRoute::getControllerName', targetQualifiedName: 'app\\mycontroller', kind: 'class_reference', line: 12 },
    ]);
    await refRepo.resolveTargets(repo.id);

    const flowDeps: ToolDeps = { repoId: repo.id, symbolRepo, refRepo };
    const result = await handleFlow(flowDeps, { symbol: 'App\\MyRoute', depth: 3 });

    // Flow should trace through parent's init() → child's getControllerName() → Controller
    expect(result).toContain('App\\MyController');
  });
});

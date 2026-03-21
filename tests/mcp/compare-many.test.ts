import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { ReferenceRepository } from '../../src/db/repositories/reference-repository.js';
import { handleCompareMany } from '../../src/mcp/tools/compare-many.js';
import type { ToolDeps } from '../../src/mcp/types.js';
import type { ParsedSymbol } from '../../src/types.js';

function makeClassWithMethods(
  name: string,
  qn: string,
  methods: { name: string; line: number }[]
): ParsedSymbol {
  return {
    name,
    qualifiedName: qn,
    kind: 'class',
    visibility: null,
    lineStart: 1,
    lineEnd: 40,
    signature: null,
    returnType: null,
    docblock: null,
    metadata: {},
    children: methods.map((method) => ({
      name: method.name,
      qualifiedName: `${qn}::${method.name}`,
      kind: 'method' as const,
      visibility: 'public',
      lineStart: method.line,
      lineEnd: method.line + 2,
      signature: null,
      returnType: null,
      docblock: null,
      metadata: {},
      children: [],
    })),
  };
}

describe('cartograph_compare_many', () => {
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
    const baselineFile = fileRepo.upsert(repo.id, 'app/JobCostCenters.php', 'php', 'a', 20);
    const recurringFile = fileRepo.upsert(repo.id, 'app/RecurringJobCostCenters.php', 'php', 'b', 20);
    const quoteFile = fileRepo.upsert(repo.id, 'app/QuoteCostCenters.php', 'php', 'c', 20);

    symbolRepo.replaceFileSymbols(baselineFile.id, [
      makeClassWithMethods('JobCostCenters', 'App\\JobCostCenters', [
        { name: 'getControllerName', line: 3 },
        { name: 'getBuilderName', line: 6 },
        { name: 'getSubRouteFolder', line: 9 },
      ]),
    ]);
    symbolRepo.replaceFileSymbols(recurringFile.id, [
      makeClassWithMethods('RecurringJobCostCenters', 'App\\RecurringJobCostCenters', [
        { name: 'getControllerName', line: 3 },
        { name: 'getBuilderName', line: 6 },
      ]),
    ]);
    symbolRepo.replaceFileSymbols(quoteFile.id, [
      makeClassWithMethods('QuoteCostCenters', 'App\\QuoteCostCenters', [
        { name: 'getControllerName', line: 3 },
        { name: 'getBuilderName', line: 6 },
        { name: 'getSubRouteFolder', line: 9 },
        { name: 'getExtraThing', line: 12 },
      ]),
    ]);

    deps = { repoId: repo.id, symbolRepo, refRepo };
  });

  afterAll(() => {
    db.close();
  });

  it('summarizes missing and extra methods across several targets', () => {
    const result = handleCompareMany(deps, {
      baseline: 'App\\JobCostCenters',
      others: ['App\\RecurringJobCostCenters', 'App\\QuoteCostCenters'],
    });

    expect(result).toContain('## Compare Many: App\\JobCostCenters');
    expect(result).toContain('Missing from target compared to baseline (1): getSubRouteFolder');
    expect(result).toContain('Extra in target (1): getExtraThing');
  });

  it('reports missing targets without failing the whole comparison', () => {
    const result = handleCompareMany(deps, {
      baseline: 'App\\JobCostCenters',
      others: ['App\\MissingSibling'],
    });

    expect(result).toContain('### vs App\\MissingSibling');
    expect(result).toContain('Symbol not found');
  });
});

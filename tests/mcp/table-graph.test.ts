import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { DbSchemaRepository } from '../../src/db/repositories/db-schema-repository.js';
import { handleTableGraph } from '../../src/mcp/tools/table-graph.js';
import type { ToolDeps } from '../../src/mcp/types.js';

describe('cartograph_table_graph', () => {
  let db: Database.Database;
  let deps: ToolDeps;

  beforeAll(() => {
    db = openDatabase({ path: ':memory:' });
    runMigrations(db);

    const repoRepo = new RepoRepository(db);
    const schemaRepo = new DbSchemaRepository(db);
    const repo = repoRepo.findOrCreate('/test/repo', 'test');

    schemaRepo.replaceCurrentSchemaFromImport(repo.id, [
      {
        name: 'accounts',
        normalizedName: 'accounts',
        sourcePath: null,
        lineStart: null,
        lineEnd: null,
        columns: [{ name: 'id', normalizedName: 'id', dataType: 'integer', isNullable: false, defaultValue: null, ordinalPosition: 1, sourcePath: null, lineNumber: null }],
        foreignKeys: [],
      },
      {
        name: 'users',
        normalizedName: 'users',
        sourcePath: null,
        lineStart: null,
        lineEnd: null,
        columns: [
          { name: 'id', normalizedName: 'id', dataType: 'integer', isNullable: false, defaultValue: null, ordinalPosition: 1, sourcePath: null, lineNumber: null },
          { name: 'account_id', normalizedName: 'account_id', dataType: 'integer', isNullable: true, defaultValue: null, ordinalPosition: 2, sourcePath: null, lineNumber: null },
        ],
        foreignKeys: [
          {
            constraintName: 'users_account_id_fkey',
            sourceColumns: ['account_id'],
            targetTable: 'accounts',
            normalizedTargetTable: 'accounts',
            targetColumns: ['id'],
            sourcePath: null,
            lineNumber: null,
          },
        ],
      },
      {
        name: 'orders',
        normalizedName: 'orders',
        sourcePath: null,
        lineStart: null,
        lineEnd: null,
        columns: [
          { name: 'id', normalizedName: 'id', dataType: 'integer', isNullable: false, defaultValue: null, ordinalPosition: 1, sourcePath: null, lineNumber: null },
          { name: 'user_id', normalizedName: 'user_id', dataType: 'integer', isNullable: false, defaultValue: null, ordinalPosition: 2, sourcePath: null, lineNumber: null },
        ],
        foreignKeys: [
          {
            constraintName: 'orders_user_id_fkey',
            sourceColumns: ['user_id'],
            targetTable: 'users',
            normalizedTargetTable: 'users',
            targetColumns: ['id'],
            sourcePath: null,
            lineNumber: null,
          },
        ],
      },
      {
        name: 'payments',
        normalizedName: 'payments',
        sourcePath: null,
        lineStart: null,
        lineEnd: null,
        columns: [
          { name: 'id', normalizedName: 'id', dataType: 'integer', isNullable: false, defaultValue: null, ordinalPosition: 1, sourcePath: null, lineNumber: null },
          { name: 'order_id', normalizedName: 'order_id', dataType: 'integer', isNullable: false, defaultValue: null, ordinalPosition: 2, sourcePath: null, lineNumber: null },
        ],
        foreignKeys: [
          {
            constraintName: 'payments_order_id_fkey',
            sourceColumns: ['order_id'],
            targetTable: 'orders',
            normalizedTargetTable: 'orders',
            targetColumns: ['id'],
            sourcePath: null,
            lineNumber: null,
          },
        ],
      },
    ]);

    deps = {
      repoId: repo.id,
      repoPath: undefined,
      symbolRepo: undefined as never,
      refRepo: undefined as never,
      schemaRepo,
    };
  });

  afterAll(() => {
    db.close();
  });

  it('traverses inbound and outbound foreign-key neighbors', () => {
    const result = handleTableGraph(deps, { name: 'users', depth: 2 });

    expect(result).toContain('## Table Graph: users');
    expect(result).toContain('Visited tables: 4');
    expect(result).toContain('depth 0: users — 2 columns, 1 outbound FKs, 1 inbound FKs');
    expect(result).toContain('depth 1: accounts — 1 columns, 0 outbound FKs, 1 inbound FKs');
    expect(result).toContain('depth 1: orders — 2 columns, 1 outbound FKs, 1 inbound FKs');
    expect(result).toContain('depth 2: payments — 2 columns, 1 outbound FKs, 0 inbound FKs');
    expect(result).toContain('Depth 1:');
    expect(result).toContain('- outbound: users(account_id) -> accounts(id)');
    expect(result).toContain('- inbound: orders(user_id) -> users(id)');
    expect(result).toContain('Depth 2:');
    expect(result).toContain('- inbound: payments(order_id) -> orders(id)');
  });
});

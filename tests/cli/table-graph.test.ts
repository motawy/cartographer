import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { DbSchemaRepository } from '../../src/db/repositories/db-schema-repository.js';
import { renderTableGraphForRepo } from '../../src/cli/table-graph.js';

describe('renderTableGraphForRepo', () => {
  it('renders the foreign-key neighborhood for an indexed table', () => {
    const db = openDatabase({ path: ':memory:' });

    try {
      runMigrations(db);
      const repoRepo = new RepoRepository(db);
      const schemaRepo = new DbSchemaRepository(db);
      const repo = repoRepo.findOrCreate('/test/repo', 'test');

      schemaRepo.replaceCurrentSchemaFromImport(repo.id, [
        {
          name: 'quotes',
          normalizedName: 'quotes',
          sourcePath: null,
          lineStart: null,
          lineEnd: null,
          columns: [
            { name: 'id', normalizedName: 'id', dataType: 'integer', isNullable: false, defaultValue: null, ordinalPosition: 1, sourcePath: null, lineNumber: null },
            { name: 'account_id', normalizedName: 'account_id', dataType: 'integer', isNullable: false, defaultValue: null, ordinalPosition: 2, sourcePath: null, lineNumber: null },
          ],
          foreignKeys: [
            {
              constraintName: 'quotes_account_id_fkey',
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
          name: 'accounts',
          normalizedName: 'accounts',
          sourcePath: null,
          lineStart: null,
          lineEnd: null,
          columns: [
            { name: 'id', normalizedName: 'id', dataType: 'integer', isNullable: false, defaultValue: null, ordinalPosition: 1, sourcePath: null, lineNumber: null },
          ],
          foreignKeys: [],
        },
      ]);

      const result = renderTableGraphForRepo(db, '/test/repo', 'quotes', 1);
      expect(result).toContain('## Table Graph: quotes');
      expect(result).toContain('- outbound: quotes(account_id) -> accounts(id)');
    } finally {
      db.close();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { DbSchemaRepository } from '../../src/db/repositories/db-schema-repository.js';
import { renderSchemaForRepo } from '../../src/cli/schema.js';

describe('renderSchemaForRepo', () => {
  it('renders current schema summaries for an indexed repo', () => {
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
            {
              name: 'id',
              normalizedName: 'id',
              dataType: 'integer',
              isNullable: false,
              defaultValue: null,
              ordinalPosition: 1,
              sourcePath: null,
              lineNumber: null,
            },
          ],
          foreignKeys: [],
        },
      ]);

      const result = renderSchemaForRepo(db, '/test/repo');
      expect(result).toContain('## Schema');
      expect(result).toContain('quotes — 1 columns, 0 outbound FKs, 0 inbound FKs');
    } finally {
      db.close();
    }
  });
});

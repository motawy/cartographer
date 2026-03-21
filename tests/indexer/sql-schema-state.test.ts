import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildCurrentSqlSchema } from '../../src/indexer/sql-schema-state.js';

describe('buildCurrentSqlSchema', () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replays ordered sql migrations into one current table state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cartograph-sql-state-'));
    tempDirs.push(dir);

    const createPath = join(dir, '001_create_quotes.sql');
    const alterPath = join(dir, '002_alter_quotes.sql');
    const fkPath = join(dir, '003_quotes_fk.sql');

    writeFileSync(
      createPath,
      `CREATE TABLE quotes (
  id INT NOT NULL,
  legacy_code VARCHAR(20),
  created_at DATETIME
);
`
    );
    writeFileSync(
      alterPath,
      `ALTER TABLE quotes
  DROP COLUMN legacy_code,
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'draft',
  CHANGE COLUMN created_at created_on DATETIME NOT NULL;
`
    );
    writeFileSync(
      fkPath,
      `ALTER TABLE quotes
  ADD COLUMN customer_id INT NOT NULL,
  ADD CONSTRAINT fk_quotes_customer FOREIGN KEY (customer_id) REFERENCES customers(id);
`
    );

    const tables = buildCurrentSqlSchema([
      { path: 'db/migrations/001_create_quotes.sql', absolutePath: createPath },
      { path: 'db/migrations/002_alter_quotes.sql', absolutePath: alterPath },
      { path: 'db/migrations/003_quotes_fk.sql', absolutePath: fkPath },
    ]);

    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      name: 'quotes',
      normalizedName: 'quotes',
      sourcePath: 'db/migrations/003_quotes_fk.sql',
    });
    expect(tables[0]?.columns.map((column) => column.name)).toEqual([
      'id',
      'status',
      'created_on',
      'customer_id',
    ]);
    expect(tables[0]?.columns.find((column) => column.name === 'status')).toMatchObject({
      dataType: 'VARCHAR(20)',
      isNullable: false,
      defaultValue: "'draft'",
      sourcePath: 'db/migrations/002_alter_quotes.sql',
    });
    expect(tables[0]?.foreignKeys).toEqual([
      expect.objectContaining({
        constraintName: 'fk_quotes_customer',
        sourceColumns: ['customer_id'],
        targetTable: 'customers',
        targetColumns: ['id'],
        sourcePath: 'db/migrations/003_quotes_fk.sql',
      }),
    ]);
  });

  it('handles table rename and drop statements', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cartograph-sql-rename-'));
    tempDirs.push(dir);

    const createPath = join(dir, '001_create_quote_drafts.sql');
    const renamePath = join(dir, '002_rename_quote_drafts.sql');
    const dropPath = join(dir, '003_drop_archive.sql');

    writeFileSync(createPath, 'CREATE TABLE quote_drafts (id INT NOT NULL);');
    writeFileSync(renamePath, 'ALTER TABLE quote_drafts RENAME TO quotes;');
    writeFileSync(dropPath, 'DROP TABLE IF EXISTS archive_quotes;');

    const tables = buildCurrentSqlSchema([
      { path: '001_create_quote_drafts.sql', absolutePath: createPath },
      { path: '002_rename_quote_drafts.sql', absolutePath: renamePath },
      { path: '003_drop_archive.sql', absolutePath: dropPath },
    ]);

    expect(tables.map((table) => table.name)).toEqual(['quotes']);
  });
});

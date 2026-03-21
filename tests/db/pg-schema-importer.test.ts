import { describe, expect, it } from 'vitest';
import { buildImportedTables } from '../../src/db/pg-schema-importer.js';

describe('buildImportedTables', () => {
  it('groups PostgreSQL information schema rows into canonical current tables', () => {
    const tables = buildImportedTables(
      [
        { table_name: 'accounts' },
        { table_name: 'quotes' },
      ],
      [
        {
          table_name: 'quotes',
          column_name: 'id',
          data_type: 'integer',
          is_nullable: 'NO',
          column_default: "nextval('quotes_id_seq'::regclass)",
          ordinal_position: 1,
        },
        {
          table_name: 'quotes',
          column_name: 'account_id',
          data_type: 'integer',
          is_nullable: 'YES',
          column_default: null,
          ordinal_position: 2,
        },
      ],
      [
        {
          constraint_name: 'quotes_account_id_fkey',
          source_table: 'quotes',
          source_column: 'account_id',
          target_table: 'accounts',
          target_column: 'id',
        },
      ]
    );

    expect(tables).toEqual([
      {
        name: 'accounts',
        normalizedName: 'accounts',
        sourcePath: null,
        lineStart: null,
        lineEnd: null,
        columns: [],
        foreignKeys: [],
      },
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
            defaultValue: "nextval('quotes_id_seq'::regclass)",
            ordinalPosition: 1,
            sourcePath: null,
            lineNumber: null,
          },
          {
            name: 'account_id',
            normalizedName: 'account_id',
            dataType: 'integer',
            isNullable: true,
            defaultValue: null,
            ordinalPosition: 2,
            sourcePath: null,
            lineNumber: null,
          },
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
    ]);
  });

  it('deduplicates repeated foreign-key column pairs from import rows', () => {
    const tables = buildImportedTables(
      [{ table_name: 'recurring_quotes' }, { table_name: 'recurring_job_team' }],
      [],
      [
        {
          constraint_name: 'fk_recurring_job_id',
          source_table: 'recurring_job_team',
          source_column: 'recurring_job_id',
          target_table: 'recurring_quotes',
          target_column: 'quote_id',
        },
        {
          constraint_name: 'fk_recurring_job_id',
          source_table: 'recurring_job_team',
          source_column: 'recurring_job_id',
          target_table: 'recurring_quotes',
          target_column: 'quote_id',
        },
      ]
    );

    const teamTable = tables.find((table) => table.name === 'recurring_job_team');
    expect(teamTable?.foreignKeys).toEqual([
      {
        constraintName: 'fk_recurring_job_id',
        sourceColumns: ['recurring_job_id'],
        targetTable: 'recurring_quotes',
        normalizedTargetTable: 'recurring_quotes',
        targetColumns: ['quote_id'],
        sourcePath: null,
        lineNumber: null,
      },
    ]);
  });
});

import { readFileSync } from 'fs';
import type {
  MaterializedDbColumn,
  MaterializedDbForeignKey,
  MaterializedDbTable,
  ParsedDbTable,
} from '../types.js';
import { normalizeSchemaName } from '../db/repositories/db-schema-repository.js';
import { extractSqlSchemaFromSource } from './sql-schema-extractor.js';

interface SqlFileInput {
  path: string;
  absolutePath: string;
}

interface SqlStatement {
  text: string;
  lineStart: number;
}

interface CurrentTableState {
  name: string;
  normalizedName: string;
  sourcePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  columns: MaterializedDbColumn[];
  foreignKeys: MaterializedDbForeignKey[];
}

const COLUMN_STOP_WORD_PATTERN = 'constraint|not|null|default|primary|unique|references|check|collate|generated|comment|after|first';

export function buildCurrentSqlSchema(files: SqlFileInput[]): MaterializedDbTable[] {
  const tables = new Map<string, CurrentTableState>();

  const migrationFiles = [...files]
    .filter((f) => migrationSortKey(f.path) < 999999999)
    .sort((a, b) => compareMigrationPaths(a.path, b.path));

  for (const file of migrationFiles) {
    const source = readFileSync(file.absolutePath, 'utf-8');
    const stripped = stripSqlComments(source);
    const statements = splitSqlStatements(stripped);

    for (const statement of statements) {
      const lowered = statement.text.trim().toLowerCase();
      if (!lowered) continue;

      if (lowered.startsWith('create table')) {
        applyCreateTableStatement(tables, file.path, statement);
        continue;
      }

      if (lowered.startsWith('alter table')) {
        applyAlterTableStatement(tables, file.path, statement);
        continue;
      }

      if (lowered.startsWith('rename table')) {
        applyRenameTableStatement(tables, file.path, statement);
        continue;
      }

      if (lowered.startsWith('drop table')) {
        applyDropTableStatement(tables, statement);
        continue;
      }

      if (lowered.startsWith('insert into') && /tmp_schema_columns/i.test(lowered)) {
        applyBootstrapColumnsInsert(tables, file.path, statement);
      }
    }
  }

  return [...tables.values()]
    .map((table) => ({
      name: table.name,
      normalizedName: table.normalizedName,
      sourcePath: table.sourcePath,
      lineStart: table.lineStart,
      lineEnd: table.lineEnd,
      columns: [...table.columns].sort((a, b) => a.ordinalPosition - b.ordinalPosition),
      foreignKeys: [...table.foreignKeys],
    }))
    .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));
}

function applyCreateTableStatement(
  tables: Map<string, CurrentTableState>,
  sourcePath: string,
  statement: SqlStatement
): void {
  const parsedTables = extractSqlSchemaFromSource(statement.text);
  if (parsedTables.length === 0) return;

  for (const parsed of parsedTables) {
    const offset = statement.lineStart - 1;
    tables.set(parsed.normalizedName, toCurrentTable(parsed, sourcePath, offset));
  }
}

function applyAlterTableStatement(
  tables: Map<string, CurrentTableState>,
  sourcePath: string,
  statement: SqlStatement
): void {
  const match = statement.text.match(/^alter\s+table\s+([`"\[]?[A-Za-z0-9_.]+[`"\]]?)\s+([\s\S]+)$/i);
  if (!match) return;

  const tableName = unquoteIdentifier(match[1]);
  const normalizedName = normalizeSchemaName(tableName);
  const table = tables.get(normalizedName);
  if (!table) return;

  const operationsSource = match[2];
  const operations = splitTopLevel(operationsSource, ',');
  let changed = false;
  for (const op of operations) {
    const trimmed = op.text.trim();
    if (!trimmed) continue;
    const lineNumber = statement.lineStart + countNewlines(operationsSource, op.offset);

    if (applyRenameTo(table, tables, trimmed, sourcePath, lineNumber)) {
      changed = true;
      continue;
    }
    if (applyAddColumn(table, trimmed, sourcePath, lineNumber)) {
      changed = true;
      continue;
    }
    if (applyModifyColumn(table, trimmed, sourcePath, lineNumber)) {
      changed = true;
      continue;
    }
    if (applyChangeColumn(table, trimmed, sourcePath, lineNumber)) {
      changed = true;
      continue;
    }
    if (applyDropColumn(table, trimmed)) {
      changed = true;
      continue;
    }
    if (applyAddForeignKey(table, trimmed, sourcePath, lineNumber)) {
      changed = true;
      continue;
    }
    if (applyDropForeignKey(table, trimmed)) {
      changed = true;
      continue;
    }
    if (applyAlterColumn(table, trimmed)) {
      changed = true;
      continue;
    }
    if (applyRenameColumn(table, trimmed)) {
      changed = true;
      continue;
    }
  }

  if (changed) {
    table.sourcePath = sourcePath;
    table.lineStart = statement.lineStart;
    table.lineEnd = statement.lineStart + countNewlines(statement.text, statement.text.length);
  }
}

function applyRenameTableStatement(
  tables: Map<string, CurrentTableState>,
  sourcePath: string,
  statement: SqlStatement
): void {
  const match = statement.text.match(
    /^rename\s+table\s+([`"\[]?[A-Za-z0-9_.]+[`"\]]?)\s+to\s+([`"\[]?[A-Za-z0-9_.]+[`"\]]?)$/i
  );
  if (!match) return;

  const oldName = normalizeSchemaName(match[1]);
  const table = tables.get(oldName);
  if (!table) return;

  tables.delete(oldName);
  table.name = unquoteIdentifier(match[2]);
  table.normalizedName = normalizeSchemaName(match[2]);
  table.sourcePath = sourcePath;
  table.lineStart = statement.lineStart;
  table.lineEnd = statement.lineStart;
  tables.set(table.normalizedName, table);
}

function applyDropTableStatement(
  tables: Map<string, CurrentTableState>,
  statement: SqlStatement
): void {
  const match = statement.text.match(/^drop\s+table\s+(?:if\s+exists\s+)?([`"\[]?[A-Za-z0-9_.]+[`"\]]?)/i);
  if (!match) return;
  tables.delete(normalizeSchemaName(match[1]));
}

/**
 * Parses the simpro bootstrap file `create_columns_fix_existing.sql` which
 * inserts rows into a temp table `tmp_schema_columns` with structured column
 * definitions:
 *   ('table_name','column_name','data_type',notnull,hasdefault,'default_value','column_def')
 *
 * Each tuple is treated as an ADD COLUMN operation on the corresponding table.
 */
function applyBootstrapColumnsInsert(
  tables: Map<string, CurrentTableState>,
  sourcePath: string,
  statement: SqlStatement
): void {
  // Parse tuples from: ('table','col','type',bool,bool,'default','col_def')
  // Values may contain '' (SQL-escaped single quotes), so we parse field by field.
  const text = statement.text;
  let idx = 0;

  while (idx < text.length) {
    // Find start of next tuple
    idx = text.indexOf('(', idx);
    if (idx === -1) break;
    idx++; // skip '('

    const fields: string[] = [];
    let valid = true;

    for (let f = 0; f < 7 && valid; f++) {
      // Skip whitespace
      while (idx < text.length && /[\s,]/.test(text[idx]!)) idx++;

      if (text[idx] === "'") {
        // Quoted field — read until unescaped closing quote
        idx++; // skip opening quote
        let value = '';
        while (idx < text.length) {
          if (text[idx] === "'" && text[idx + 1] === "'") {
            value += "'";
            idx += 2;
          } else if (text[idx] === "'") {
            idx++; // skip closing quote
            break;
          } else {
            value += text[idx];
            idx++;
          }
        }
        fields.push(value);
      } else {
        // Unquoted field (true/false)
        const start = idx;
        while (idx < text.length && /[a-z]/i.test(text[idx]!)) idx++;
        fields.push(text.substring(start, idx));
      }
    }

    // Skip to closing paren
    while (idx < text.length && text[idx] !== ')') idx++;
    idx++; // skip ')'

    if (fields.length < 7) continue;

    const [tableName, columnName, dataType, notNullStr, hasDefaultStr, defaultValue] = fields;
    const notNull = notNullStr === 'true';
    const hasDefault = hasDefaultStr === 'true';

    const normalizedTable = normalizeSchemaName(tableName);
    const table = tables.get(normalizedTable);
    if (!table) continue;

    // Skip if column already exists (CREATE TABLE already defined it)
    if (table.columns.some((c) => c.normalizedName === normalizeSchemaName(columnName))) {
      continue;
    }

    table.columns.push({
      name: columnName,
      normalizedName: normalizeSchemaName(columnName),
      dataType,
      isNullable: !notNull,
      defaultValue: hasDefault ? defaultValue : null,
      ordinalPosition: table.columns.length + 1,
      sourcePath,
      lineNumber: statement.lineStart,
    });
  }
}

function applyRenameTo(
  table: CurrentTableState,
  tables: Map<string, CurrentTableState>,
  operation: string,
  sourcePath: string,
  lineNumber: number
): boolean {
  const match = operation.match(/^rename\s+to\s+([`"\[]?[A-Za-z0-9_.]+[`"\]]?)$/i);
  if (!match) return false;

  tables.delete(table.normalizedName);
  table.name = unquoteIdentifier(match[1]);
  table.normalizedName = normalizeSchemaName(match[1]);
  table.sourcePath = sourcePath;
  table.lineStart = lineNumber;
  table.lineEnd = lineNumber;
  tables.set(table.normalizedName, table);
  return true;
}

function applyAddColumn(
  table: CurrentTableState,
  operation: string,
  sourcePath: string,
  lineNumber: number
): boolean {
  const match = operation.match(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]+)$/i);
  if (!match) return false;
  // Skip constraint additions — these are not column definitions
  if (/^add\s+(?:constraint|(?:constraint\s+[^\s]+\s+)?(?:foreign\s+key|primary\s+key|unique|check))/i.test(operation)) {
    return false;
  }

  const column = parseMaterializedColumn(match[1], table.columns.length + 1, sourcePath, lineNumber);
  if (!column) return false;

  upsertColumn(table, column);
  return true;
}

function applyModifyColumn(
  table: CurrentTableState,
  operation: string,
  sourcePath: string,
  lineNumber: number
): boolean {
  const match = operation.match(/^modify\s+(?:column\s+)?([\s\S]+)$/i);
  if (!match) return false;

  const existingName = extractColumnName(match[1]);
  const existing = existingName
    ? table.columns.find((column) => column.normalizedName === normalizeSchemaName(existingName))
    : null;
  const ordinal = existing?.ordinalPosition ?? table.columns.length + 1;
  const column = parseMaterializedColumn(match[1], ordinal, sourcePath, lineNumber);
  if (!column) return false;

  upsertColumn(table, column);
  return true;
}

function applyChangeColumn(
  table: CurrentTableState,
  operation: string,
  sourcePath: string,
  lineNumber: number
): boolean {
  const match = operation.match(/^change\s+(?:column\s+)?([`"\[]?[A-Za-z0-9_.]+[`"\]]?)\s+([\s\S]+)$/i);
  if (!match) return false;

  const oldName = normalizeSchemaName(match[1]);
  const existing = table.columns.find((column) => column.normalizedName === oldName);
  const ordinal = existing?.ordinalPosition ?? table.columns.length + 1;
  table.columns = table.columns.filter((column) => column.normalizedName !== oldName);

  const column = parseMaterializedColumn(match[2], ordinal, sourcePath, lineNumber);
  if (!column) return false;
  upsertColumn(table, column);
  return true;
}

function applyDropColumn(table: CurrentTableState, operation: string): boolean {
  const match = operation.match(/^drop\s+(?:column\s+)?(?:if\s+exists\s+)?([`"\[]?[A-Za-z0-9_.]+[`"\]]?)$/i);
  if (!match) return false;

  const dropped = normalizeSchemaName(match[1]);
  table.columns = table.columns.filter((column) => column.normalizedName !== dropped);
  table.foreignKeys = table.foreignKeys.filter(
    (fk) => !fk.sourceColumns.some((column) => normalizeSchemaName(column) === dropped)
  );
  return true;
}

function applyAddForeignKey(
  table: CurrentTableState,
  operation: string,
  sourcePath: string,
  lineNumber: number
): boolean {
  const withoutAdd = operation.replace(/^add\s+/i, '');
  const foreignKey = parseMaterializedForeignKey(withoutAdd, sourcePath, lineNumber);
  if (!foreignKey) return false;

  upsertForeignKey(table, foreignKey);
  return true;
}

function applyDropForeignKey(table: CurrentTableState, operation: string): boolean {
  const foreignKeyMatch = operation.match(/^drop\s+foreign\s+key\s+([`"\[]?[A-Za-z0-9_.]+[`"\]]?)$/i);
  if (foreignKeyMatch) {
    const constraint = normalizeSchemaName(foreignKeyMatch[1]);
    table.foreignKeys = table.foreignKeys.filter(
      (fk) => normalizeSchemaName(fk.constraintName ?? '') !== constraint
    );
    return true;
  }

  const constraintMatch = operation.match(/^drop\s+constraint\s+(?:if\s+exists\s+)?([`"\[]?[A-Za-z0-9_.]+[`"\]]?)$/i);
  if (!constraintMatch) return false;

  const constraint = normalizeSchemaName(constraintMatch[1]);
  table.foreignKeys = table.foreignKeys.filter(
    (fk) => normalizeSchemaName(fk.constraintName ?? '') !== constraint
  );
  return true;
}

/**
 * Handles PostgreSQL-style ALTER COLUMN operations:
 *   ALTER COLUMN col SET DEFAULT value
 *   ALTER COLUMN col DROP DEFAULT
 *   ALTER COLUMN col SET NOT NULL
 *   ALTER COLUMN col DROP NOT NULL
 *   ALTER COLUMN col TYPE typename  /  ALTER COLUMN col SET DATA TYPE typename
 */
function applyAlterColumn(table: CurrentTableState, operation: string): boolean {
  const match = operation.match(
    /^alter\s+(?:column\s+)?([`"\[]?[A-Za-z0-9_.]+[`"\]]?)\s+([\s\S]+)$/i
  );
  if (!match) return false;

  const columnName = normalizeSchemaName(match[1]);
  const action = match[2].trim();
  const lowerAction = action.toLowerCase();

  const column = table.columns.find((c) => c.normalizedName === columnName);
  if (!column) return false;

  // SET DEFAULT value
  if (/^set\s+default\s+/i.test(lowerAction)) {
    column.defaultValue = action.replace(/^set\s+default\s+/i, '').trim();
    return true;
  }

  // DROP DEFAULT
  if (/^drop\s+default$/i.test(lowerAction)) {
    column.defaultValue = null;
    return true;
  }

  // SET NOT NULL
  if (/^set\s+not\s+null$/i.test(lowerAction)) {
    column.isNullable = false;
    return true;
  }

  // DROP NOT NULL
  if (/^drop\s+not\s+null$/i.test(lowerAction)) {
    column.isNullable = true;
    return true;
  }

  // TYPE typename  or  SET DATA TYPE typename
  const typeMatch = action.match(/^(?:set\s+data\s+)?type\s+(.+?)(?:\s+using\s+.*)?$/i);
  if (typeMatch) {
    column.dataType = typeMatch[1].trim();
    return true;
  }

  return false;
}

/**
 * Handles RENAME COLUMN old TO new (PostgreSQL syntax).
 */
function applyRenameColumn(table: CurrentTableState, operation: string): boolean {
  const match = operation.match(
    /^rename\s+column\s+([`"\[]?[A-Za-z0-9_.]+[`"\]]?)\s+to\s+([`"\[]?[A-Za-z0-9_.]+[`"\]]?)$/i
  );
  if (!match) return false;

  const oldName = normalizeSchemaName(match[1]);
  const column = table.columns.find((c) => c.normalizedName === oldName);
  if (!column) return false;

  column.name = unquoteIdentifier(match[2]);
  column.normalizedName = normalizeSchemaName(match[2]);

  // Update any foreign keys that reference the old column name
  for (const fk of table.foreignKeys) {
    fk.sourceColumns = fk.sourceColumns.map((c) =>
      normalizeSchemaName(c) === oldName ? column.name : c
    );
  }

  return true;
}

function toCurrentTable(
  parsed: ParsedDbTable,
  sourcePath: string,
  lineOffset: number
): CurrentTableState {
  return {
    name: parsed.name,
    normalizedName: parsed.normalizedName,
    sourcePath,
    lineStart: parsed.lineStart + lineOffset,
    lineEnd: parsed.lineEnd + lineOffset,
    columns: parsed.columns.map((column) => ({
      name: column.name,
      normalizedName: column.normalizedName,
      dataType: column.dataType,
      isNullable: column.isNullable,
      defaultValue: column.defaultValue,
      ordinalPosition: column.ordinalPosition,
      sourcePath,
      lineNumber: column.lineNumber === null ? null : column.lineNumber + lineOffset,
    })),
    foreignKeys: parsed.foreignKeys.map((fk) => ({
      constraintName: fk.constraintName,
      sourceColumns: [...fk.sourceColumns],
      targetTable: fk.targetTable,
      normalizedTargetTable: fk.normalizedTargetTable,
      targetColumns: [...fk.targetColumns],
      sourcePath,
      lineNumber: fk.lineNumber === null ? null : fk.lineNumber + lineOffset,
    })),
  };
}

function parseMaterializedColumn(
  definition: string,
  ordinalPosition: number,
  sourcePath: string,
  lineNumber: number
): MaterializedDbColumn | null {
  const trimmed = definition.trim();
  const columnName = extractColumnName(trimmed);
  if (!columnName) return null;

  const remainder = trimmed.substring(trimmed.match(/^([`"\[]?[A-Za-z0-9_.]+[`"\]]?)/)?.[0].length ?? 0).trim();
  const lowerRemainder = remainder.toLowerCase();
  const typeMatch = remainder.match(
    new RegExp(`^(.+?)(?=\\s+(?:${COLUMN_STOP_WORD_PATTERN})\\b|$)`, 'i')
  );
  const dataType = typeMatch ? typeMatch[1].trim() : null;
  const isNullable = !/\bnot\s+null\b/i.test(lowerRemainder);
  const defaultMatch = remainder.match(
    new RegExp(`\\bdefault\\s+(.+?)(?=\\s+(?:${COLUMN_STOP_WORD_PATTERN.replace('default|', '')})\\b|$)`, 'i')
  );
  const defaultValue = defaultMatch ? defaultMatch[1].trim() : null;

  return {
    name: columnName,
    normalizedName: normalizeSchemaName(columnName),
    dataType,
    isNullable,
    defaultValue,
    ordinalPosition,
    sourcePath,
    lineNumber,
  };
}

function parseMaterializedForeignKey(
  definition: string,
  sourcePath: string,
  lineNumber: number
): MaterializedDbForeignKey | null {
  const match = definition.match(
    /^(?:constraint\s+([`"\[]?[A-Za-z0-9_.]+[`"\]]?)\s+)?foreign\s+key\s*\(([^)]+)\)\s+references\s+([`"\[]?[A-Za-z0-9_.]+[`"\]]?)\s*\(([^)]+)\)/i
  );
  if (!match) return null;

  return {
    constraintName: match[1] ? unquoteIdentifier(match[1]) : null,
    sourceColumns: splitIdentifierList(match[2]),
    targetTable: unquoteIdentifier(match[3]),
    normalizedTargetTable: normalizeSchemaName(match[3]),
    targetColumns: splitIdentifierList(match[4]),
    sourcePath,
    lineNumber,
  };
}

function upsertColumn(table: CurrentTableState, column: MaterializedDbColumn): void {
  const existingIdx = table.columns.findIndex(
    (entry) => entry.normalizedName === column.normalizedName
  );
  if (existingIdx === -1) {
    table.columns.push(column);
    return;
  }

  table.columns[existingIdx] = column;
}

function upsertForeignKey(table: CurrentTableState, foreignKey: MaterializedDbForeignKey): void {
  const key = foreignKeyIdentity(foreignKey);
  const existingIdx = table.foreignKeys.findIndex((entry) => foreignKeyIdentity(entry) === key);
  if (existingIdx === -1) {
    table.foreignKeys.push(foreignKey);
    return;
  }

  table.foreignKeys[existingIdx] = foreignKey;
}

function foreignKeyIdentity(fk: MaterializedDbForeignKey): string {
  if (fk.constraintName) {
    return `constraint:${normalizeSchemaName(fk.constraintName)}`;
  }

  return [
    fk.sourceColumns.map((column) => normalizeSchemaName(column)).join(','),
    fk.normalizedTargetTable,
    fk.targetColumns.map((column) => normalizeSchemaName(column)).join(','),
  ].join('->');
}

function extractColumnName(definition: string): string | null {
  const match = definition.trim().match(/^([`"\[]?[A-Za-z0-9_.]+[`"\]]?)/);
  return match ? unquoteIdentifier(match[1]) : null;
}

function stripSqlComments(source: string): string {
  let result = source;
  result = result.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
  result = result.replace(/--.*$/gm, (match) => ' '.repeat(match.length));
  return result;
}

function splitSqlStatements(source: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let idx = 0; idx < source.length; idx++) {
    const char = source[idx]!;

    if (quote) {
      if (char === quote && source[idx - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') depth++;
    if (char === ')') depth--;

    if (char === ';' && depth === 0) {
      const text = source.substring(start, idx).trim();
      if (text) {
        statements.push({
          text,
          lineStart: lineNumberAt(source, start),
        });
      }
      start = idx + 1;
    }
  }

  const trailing = source.substring(start).trim();
  if (trailing) {
    statements.push({
      text: trailing,
      lineStart: lineNumberAt(source, start),
    });
  }

  return statements;
}

function splitTopLevel(input: string, separator: string): { text: string; offset: number }[] {
  const parts: { text: string; offset: number }[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let idx = 0; idx < input.length; idx++) {
    const char = input[idx]!;

    if (quote) {
      if (char === quote && input[idx - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') depth++;
    if (char === ')') depth--;

    if (char === separator && depth === 0) {
      parts.push({ text: input.substring(start, idx), offset: start });
      start = idx + 1;
    }
  }

  parts.push({ text: input.substring(start), offset: start });
  return parts;
}

function splitIdentifierList(input: string): string[] {
  return input
    .split(',')
    .map((part) => unquoteIdentifier(part))
    .filter(Boolean);
}

function unquoteIdentifier(input: string): string {
  return input
    .trim()
    .split('.')
    .map((part) => part.trim().replace(/^[`"\[]+|[`"\]]+$/g, ''))
    .join('.');
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let idx = 0; idx < offset; idx++) {
    if (source[idx] === '\n') line++;
  }
  return line;
}

function countNewlines(source: string, endOffset: number): number {
  let count = 0;
  for (let idx = 0; idx < endOffset; idx++) {
    if (source[idx] === '\n') count++;
  }
  return count;
}

/**
 * Sort migration files so that:
 *   1. "initial" / "source" directories come first
 *   2. Version directories sort numerically (11_0_0_0 < 11_2_0_0 < 12_0_0_0)
 *   3. Within increments, files sort by their timestamp-prefixed names
 */
function compareMigrationPaths(a: string, b: string): number {
  const aRank = migrationSortKey(a);
  const bRank = migrationSortKey(b);
  if (aRank !== bRank) return aRank - bRank;
  return a.localeCompare(b);
}

function migrationSortKey(path: string): number {
  const lower = path.toLowerCase();

  // "initial/source" comes first (CREATE TABLE definitions — the base schema)
  if (/\binitial\b.*\bsource\b/.test(lower)) return 0;

  // Version directories: extract version number for numeric sort
  const versionMatch = lower.match(/(\d+)[_.](\d+)[_.](\d+)[_.](\d+)/);
  if (versionMatch) {
    return (
      1 +
      parseInt(versionMatch[1]) * 1000000 +
      parseInt(versionMatch[2]) * 10000 +
      parseInt(versionMatch[3]) * 100 +
      parseInt(versionMatch[4])
    );
  }

  // Fallback: sort after everything else
  return 999999999;
}


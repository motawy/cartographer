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

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
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
  const match = operation.match(/^add\s+(?:column\s+)?([\s\S]+)$/i);
  if (!match) return false;
  if (/^add\s+(?:constraint\s+[^\s]+\s+)?foreign\s+key/i.test(operation)) {
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
  const match = operation.match(/^drop\s+(?:column\s+)?([`"\[]?[A-Za-z0-9_.]+[`"\]]?)$/i);
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

  const constraintMatch = operation.match(/^drop\s+constraint\s+([`"\[]?[A-Za-z0-9_.]+[`"\]]?)$/i);
  if (!constraintMatch) return false;

  const constraint = normalizeSchemaName(constraintMatch[1]);
  table.foreignKeys = table.foreignKeys.filter(
    (fk) => normalizeSchemaName(fk.constraintName ?? '') !== constraint
  );
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

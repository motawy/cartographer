import { normalizeSchemaName } from '../../db/repositories/db-schema-repository.js';
import type { DbCurrentTableSummaryRecord } from '../../db/repositories/db-schema-repository.js';
import type { ToolDeps } from '../types.js';

interface TableGraphParams {
  name: string;
  depth?: number;
}

type TableGraphDeps = Pick<ToolDeps, 'repoId' | 'schemaRepo'>;

interface GraphEdge {
  depth: number;
  direction: 'outbound' | 'inbound';
  sourceTable: string;
  sourceColumns: string[];
  targetTable: string;
  targetColumns: string[];
}

export function handleTableGraph(deps: TableGraphDeps, params: TableGraphParams): string {
  const { repoId, schemaRepo } = deps;
  if (!schemaRepo) {
    throw new Error('Schema repository is not available.');
  }

  const matches = schemaRepo.findCurrentTablesByName(repoId, params.name, 10);
  if (matches.length === 0) {
    return `Table not found: "${params.name}".`;
  }

  const normalized = normalizeSchemaName(params.name);
  const exactMatch = matches.find((match) => match.normalizedName === normalized);
  const start = exactMatch ?? matches[0]!;

  if (!exactMatch && matches.length > 1) {
    return [
      `Multiple tables match "${params.name}".`,
      '',
      ...matches.map((match) => `- ${match.name}`),
      '',
      'Retry with the full table name for an exact match.',
    ].join('\n');
  }

  const maxDepth = Math.max(1, Math.min(params.depth ?? 1, 5));
  const summaryCache = new Map<string, DbCurrentTableSummaryRecord>();
  const visited = new Map<string, { summary: DbCurrentTableSummaryRecord; depth: number }>();
  const queue: Array<{ summary: DbCurrentTableSummaryRecord; depth: number }> = [];
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const startSummary = getSummary(schemaRepo, repoId, start.normalizedName, summaryCache);
  if (!startSummary) {
    return `Table not found: "${params.name}".`;
  }

  visited.set(startSummary.normalizedName, { summary: startSummary, depth: 0 });
  queue.push({ summary: startSummary, depth: 0 });

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    const outgoing = schemaRepo.findCurrentOutgoingForeignKeys(current.summary.id);
    for (const fk of outgoing) {
      const edge: GraphEdge = {
        depth: current.depth + 1,
        direction: 'outbound',
        sourceTable: current.summary.name,
        sourceColumns: fk.sourceColumns,
        targetTable: fk.targetTable,
        targetColumns: fk.targetColumns,
      };
      pushEdge(edges, edgeKeys, edge);

      const neighbor = getSummary(
        schemaRepo,
        repoId,
        normalizeSchemaName(fk.targetTable),
        summaryCache
      );
      if (neighbor && !visited.has(neighbor.normalizedName)) {
        visited.set(neighbor.normalizedName, { summary: neighbor, depth: current.depth + 1 });
        queue.push({ summary: neighbor, depth: current.depth + 1 });
      }
    }

    const incoming = schemaRepo.findCurrentIncomingForeignKeys(repoId, current.summary.normalizedName);
    for (const fk of incoming) {
      const sourceTable = fk.tableName ?? 'unknown_table';
      const edge: GraphEdge = {
        depth: current.depth + 1,
        direction: 'inbound',
        sourceTable,
        sourceColumns: fk.sourceColumns,
        targetTable: current.summary.name,
        targetColumns: fk.targetColumns,
      };
      pushEdge(edges, edgeKeys, edge);

      const neighbor = fk.tableName
        ? getSummary(schemaRepo, repoId, normalizeSchemaName(fk.tableName), summaryCache)
        : null;
      if (neighbor && !visited.has(neighbor.normalizedName)) {
        visited.set(neighbor.normalizedName, { summary: neighbor, depth: current.depth + 1 });
        queue.push({ summary: neighbor, depth: current.depth + 1 });
      }
    }
  }

  const lines: string[] = [];
  lines.push(`## Table Graph: ${startSummary.name}`);
  lines.push(`- Depth: ${maxDepth}`);
  lines.push(`- Visited tables: ${visited.size}`);
  lines.push('');
  lines.push('### Tables');

  const tablesByDepth = [...visited.values()].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.summary.normalizedName.localeCompare(b.summary.normalizedName);
  });
  for (const entry of tablesByDepth) {
    lines.push(
      `- depth ${entry.depth}: ${entry.summary.name} — ${entry.summary.columnCount} columns, ` +
      `${entry.summary.outboundForeignKeyCount} outbound FKs, ${entry.summary.incomingForeignKeyCount} inbound FKs`
    );
  }

  if (edges.length === 0) {
    lines.push('');
    lines.push('### Edges');
    lines.push('No foreign key relationships were found within the requested depth.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('### Edges');
  const grouped = new Map<number, GraphEdge[]>();
  for (const edge of edges) {
    const bucket = grouped.get(edge.depth) ?? [];
    bucket.push(edge);
    grouped.set(edge.depth, bucket);
  }

  for (const depth of [...grouped.keys()].sort((a, b) => a - b)) {
    lines.push(`Depth ${depth}:`);
    const bucket = grouped.get(depth)!;
    bucket.sort((a, b) => {
      const aKey = `${a.sourceTable}->${a.targetTable}`;
      const bKey = `${b.sourceTable}->${b.targetTable}`;
      return aKey.localeCompare(bKey);
    });
    for (const edge of bucket) {
      const sourceColumns = dedupeNames(edge.sourceColumns);
      const targetColumns = dedupeNames(edge.targetColumns);
      const source = `${edge.sourceTable}(${sourceColumns.join(', ')})`;
      const target = targetColumns.length > 0
        ? `${edge.targetTable}(${targetColumns.join(', ')})`
        : edge.targetTable;
      lines.push(`- ${edge.direction}: ${source} -> ${target}`);
    }
  }

  return lines.join('\n');
}

function getSummary(
  schemaRepo: NonNullable<TableGraphDeps['schemaRepo']>,
  repoId: number,
  normalizedName: string,
  cache: Map<string, DbCurrentTableSummaryRecord>
): DbCurrentTableSummaryRecord | null {
  const cached = cache.get(normalizedName);
  if (cached) return cached;

  const summary = schemaRepo.findCurrentTableSummary(repoId, normalizedName);
  if (summary) {
    cache.set(normalizedName, summary);
  }
  return summary;
}

function pushEdge(edges: GraphEdge[], edgeKeys: Set<string>, edge: GraphEdge): void {
  const sourceColumns = dedupeNames(edge.sourceColumns);
  const targetColumns = dedupeNames(edge.targetColumns);
  const key = [
    edge.direction,
    normalizeSchemaName(edge.sourceTable),
    sourceColumns.map((column) => normalizeSchemaName(column)).join(','),
    normalizeSchemaName(edge.targetTable),
    targetColumns.map((column) => normalizeSchemaName(column)).join(','),
  ].join('|');

  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push(edge);
}

function dedupeNames(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = normalizeSchemaName(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(value);
  }
  return deduped;
}

import type { ToolDeps } from '../types.js';

interface SchemaParams {
  query?: string;
  limit?: number;
}

type SchemaDeps = Pick<ToolDeps, 'repoId' | 'schemaRepo'>;

export function handleSchema(deps: SchemaDeps, params: SchemaParams): string {
  const { repoId, schemaRepo } = deps;
  if (!schemaRepo) {
    throw new Error('Schema repository is not available.');
  }

  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
  const summaries = schemaRepo.listCurrentTableSummaries(repoId, {
    query: params.query,
    limit,
  });
  const counts = schemaRepo.countCurrentByRepo(repoId);

  if (counts.tables === 0) {
    return 'No current schema is indexed for this repository.';
  }

  if (summaries.length === 0) {
    return params.query
      ? `No current tables match "${params.query}".`
      : 'No current tables found.';
  }

  const lines: string[] = [];
  lines.push('## Schema');
  lines.push(`- Current tables: ${counts.tables}`);
  lines.push(`- Showing: ${summaries.length}`);
  if (params.query) {
    lines.push(`- Query: ${params.query}`);
  }

  lines.push('');
  for (const table of summaries) {
    lines.push(
      `- ${table.name} — ${table.columnCount} columns, ` +
      `${table.outboundForeignKeyCount} outbound FKs, ${table.incomingForeignKeyCount} inbound FKs`
    );
  }

  if (summaries.length === limit && (!params.query || counts.tables > summaries.length)) {
    lines.push('');
    lines.push('Refine with `query` or increase `limit` to see more tables.');
  }

  return lines.join('\n');
}

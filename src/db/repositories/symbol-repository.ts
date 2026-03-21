import type Database from 'better-sqlite3';
import type { ParsedSymbol } from '../../types.js';

export interface SymbolRecord {
  id: number;
  fileId: number;
  kind: string;
  name: string;
  qualifiedName: string | null;
  visibility: string | null;
  parentSymbolId: number | null;
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  returnType: string | null;
  docblock: string | null;
  metadata: Record<string, unknown>;
}

export class SymbolRepository {
  constructor(private db: Database.Database) {}

  replaceFileSymbols(
    fileId: number,
    symbols: ParsedSymbol[]
  ): Map<string, number> {
    const idMap = new Map<string, number>();

    const doReplace = this.db.transaction(() => {
      this.db.prepare('DELETE FROM symbols WHERE file_id = ?').run(fileId);

      for (const symbol of symbols) {
        this.insertSymbol(fileId, symbol, null, idMap);
      }
    });

    doReplace();
    return idMap;
  }

  private insertSymbol(
    fileId: number,
    symbol: ParsedSymbol,
    parentId: number | null,
    idMap: Map<string, number>
  ): number {
    const info = this.db.prepare(
      `INSERT INTO symbols
         (file_id, kind, name, qualified_name, visibility, parent_symbol_id,
          line_start, line_end, signature, return_type, docblock, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      fileId,
      symbol.kind,
      symbol.name,
      symbol.qualifiedName,
      symbol.visibility,
      parentId,
      symbol.lineStart,
      symbol.lineEnd,
      symbol.signature,
      symbol.returnType,
      symbol.docblock,
      JSON.stringify(symbol.metadata),
    );

    const symbolId = Number(info.lastInsertRowid);
    if (symbol.qualifiedName) {
      idMap.set(symbol.qualifiedName, symbolId);
    }

    for (const child of symbol.children) {
      this.insertSymbol(fileId, child, symbolId, idMap);
    }

    return symbolId;
  }

  findByFile(fileId: number): SymbolRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM symbols WHERE file_id = ? ORDER BY line_start'
    ).all(fileId) as Record<string, unknown>[];
    return rows.map(r => this.toRecord(r));
  }

  countByRepo(repoId: number): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS count FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE f.repo_id = ?`
    ).get(repoId) as { count: number };
    return row.count;
  }

  findByQualifiedName(repoId: number, qualifiedName: string): SymbolRecord | null {
    const row = this.db.prepare(
      `SELECT s.* FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE f.repo_id = ? AND s.qualified_name = ? COLLATE NOCASE`
    ).get(repoId, qualifiedName) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.toRecord(row);
  }

  findById(id: number): SymbolRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM symbols WHERE id = ?'
    ).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.toRecord(row);
  }

  search(
    repoId: number,
    query: string,
    kind?: string,
    limit: number = 20,
    path?: string
  ): (SymbolRecord & { filePath: string })[] {
    const params: (string | number)[] = [repoId, query];
    let sql = `SELECT s.*, f.path AS file_path FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE f.repo_id = ? AND s.qualified_name LIKE ?`;
    if (kind) {
      params.push(kind);
      sql += ` AND s.kind = ?`;
    }
    if (path) {
      params.push(`%${path}%`);
      sql += ` AND f.path LIKE ?`;
    }
    params.push(limit);
    sql += ` ORDER BY s.qualified_name LIMIT ?`;

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => ({
      ...this.toRecord(r),
      filePath: r.file_path as string,
    }));
  }

  searchContentSymbols(
    repoId: number,
    kinds: string[],
    path?: string
  ): (SymbolRecord & { filePath: string })[] {
    const params: (string | number)[] = [repoId];
    const kindPlaceholders = kinds.map(() => '?').join(', ');

    let sql = `SELECT s.*, f.path AS file_path FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE f.repo_id = ? AND s.kind IN (${kindPlaceholders})`;
    params.push(...kinds);

    if (path) {
      params.push(`%${path}%`);
      sql += ' AND f.path LIKE ?';
    }

    sql += ' ORDER BY f.path, s.line_start';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => ({
      ...this.toRecord(row),
      filePath: row.file_path as string,
    }));
  }

  findInnermostByFileAndLine(
    repoId: number,
    filePath: string,
    lineNumber: number
  ): SymbolRecord | null {
    const row = this.db.prepare(
      `SELECT s.*
       FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE f.repo_id = ?
         AND f.path = ?
         AND s.line_start <= ?
         AND s.line_end >= ?
       ORDER BY
         CASE WHEN s.kind IN ('method', 'function') THEN 0 ELSE 1 END,
         (s.line_end - s.line_start) ASC,
         s.line_start ASC
       LIMIT 1`
    ).get(repoId, filePath, lineNumber, lineNumber) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.toRecord(row);
  }

  getFilePath(fileId: number): string | null {
    const row = this.db.prepare(
      'SELECT path FROM files WHERE id = ?'
    ).get(fileId) as { path: string } | undefined;
    return row ? row.path : null;
  }

  suggestPaths(repoId: number, pathFragment: string): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT path FROM files
       WHERE repo_id = ? AND path LIKE ?
       LIMIT 20`
    ).all(repoId, `%${pathFragment}%`) as { path: string }[];

    const dirs = new Set<string>();
    for (const row of rows) {
      const lastSlash = row.path.lastIndexOf('/');
      if (lastSlash > 0) {
        dirs.add(row.path.substring(0, lastSlash));
      }
    }
    return [...dirs].sort().slice(0, 5);
  }

  suggestSymbols(
    repoId: number,
    query: string,
    kind?: string,
    path?: string,
    limit: number = 5
  ): (SymbolRecord & { filePath: string })[] {
    const tokens = tokenizeSuggestionQuery(query);
    if (tokens.length === 0) return [];

    const candidateTokens = tokens.slice(0, 4);
    const whereParts = candidateTokens.flatMap(() => [
      'lower(s.name) LIKE ?',
      'lower(s.qualified_name) LIKE ?',
    ]);
    const params: (string | number)[] = [repoId];

    let sql = `SELECT s.*, f.path AS file_path FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE f.repo_id = ? AND (${whereParts.join(' OR ')})`;

    for (const token of candidateTokens) {
      const pattern = `%${token}%`;
      params.push(pattern, pattern);
    }

    if (kind) {
      params.push(kind);
      sql += ' AND s.kind = ?';
    }
    if (path) {
      params.push(`%${path}%`);
      sql += ' AND f.path LIKE ?';
    }

    sql += ' LIMIT 200';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const candidates = rows.map((row) => ({
      ...this.toRecord(row),
      filePath: row.file_path as string,
    }));

    const normalizedQuery = normalizeSuggestionText(query);
    return candidates
      .map((candidate) => ({
        candidate,
        score: scoreSuggestionCandidate(candidate, normalizedQuery, candidateTokens),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.candidate.qualifiedName ?? a.candidate.name)
          .localeCompare(b.candidate.qualifiedName ?? b.candidate.name);
      })
      .slice(0, limit)
      .map((entry) => entry.candidate);
  }

  findByFilePath(repoId: number, filePath: string): SymbolRecord[] {
    const rows = this.db.prepare(
      `SELECT s.* FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE f.repo_id = ? AND f.path = ?
       ORDER BY s.line_start`
    ).all(repoId, filePath) as Record<string, unknown>[];
    return rows.map(r => this.toRecord(r));
  }

  findChildren(parentSymbolId: number): SymbolRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM symbols WHERE parent_symbol_id = ? ORDER BY line_start'
    ).all(parentSymbolId) as Record<string, unknown>[];
    return rows.map(r => this.toRecord(r));
  }

  private toRecord(row: Record<string, unknown>): SymbolRecord {
    return {
      id: row.id as number,
      fileId: row.file_id as number,
      kind: row.kind as string,
      name: row.name as string,
      qualifiedName: (row.qualified_name as string) || null,
      visibility: (row.visibility as string) || null,
      parentSymbolId: (row.parent_symbol_id as number) || null,
      lineStart: row.line_start as number,
      lineEnd: row.line_end as number,
      signature: (row.signature as string) || null,
      returnType: (row.return_type as string) || null,
      docblock: (row.docblock as string) || null,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
    };
  }
}

function tokenizeSuggestionQuery(query: string): string[] {
  const normalized = query
    .replace(/\\/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();

  const parts = normalized
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const merged = normalizeSuggestionText(query);
  return [...new Set([merged, ...parts].filter(Boolean))];
}

function normalizeSuggestionText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function scoreSuggestionCandidate(
  candidate: SymbolRecord & { filePath: string },
  normalizedQuery: string,
  tokens: string[]
): number {
  const qualified = (candidate.qualifiedName ?? candidate.name).toLowerCase();
  const name = candidate.name.toLowerCase();
  const normalizedName = normalizeSuggestionText(candidate.name);
  const normalizedQualified = normalizeSuggestionText(candidate.qualifiedName ?? candidate.name);

  let score = 0;

  if (normalizedName === normalizedQuery) score += 120;
  if (normalizedQualified === normalizedQuery) score += 110;
  if (name === normalizedQuery) score += 100;
  if (qualified.endsWith(`\\${normalizedQuery}`) || qualified.endsWith(`::${normalizedQuery}`)) score += 70;
  if (normalizedName.includes(normalizedQuery)) score += 50;
  if (normalizedQualified.includes(normalizedQuery)) score += 40;

  for (const token of tokens) {
    if (!token) continue;
    if (name.includes(token)) score += 12;
    if (qualified.includes(token)) score += 8;
  }

  return score;
}

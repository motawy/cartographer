import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../../src/db/connection.js';
import { runMigrations } from '../../../src/db/migrate.js';
import { RepoRepository } from '../../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../../src/db/repositories/symbol-repository.js';
import type { ParsedSymbol } from '../../../src/types.js';

// Helper to create a simple class symbol
function makeClass(name: string, qn: string, lineStart = 1, lineEnd = 10): ParsedSymbol {
  return {
    name, qualifiedName: qn, kind: 'class', visibility: null,
    lineStart, lineEnd, signature: null, returnType: null,
    docblock: null, children: [], metadata: {},
  };
}

// Helper to create a class with methods
function makeClassWithMethods(
  name: string,
  qn: string,
  methods: { name: string; line: number }[]
): ParsedSymbol {
  return {
    name, qualifiedName: qn, kind: 'class', visibility: null,
    lineStart: 1, lineEnd: 50, signature: null, returnType: null,
    docblock: null, metadata: {},
    children: methods.map(m => ({
      name: m.name,
      qualifiedName: `${qn}::${m.name}`,
      kind: 'method' as const,
      visibility: 'public' as const,
      lineStart: m.line, lineEnd: m.line + 5,
      signature: null, returnType: null, docblock: null,
      children: [], metadata: {},
    })),
  };
}

describe('SymbolRepository query methods', () => {
  let db: Database.Database;
  let repoRepo: RepoRepository;
  let fileRepo: FileRepository;
  let symbolRepo: SymbolRepository;
  let repoId: number;

  beforeAll(() => {
    db = openDatabase({ path: ':memory:' });
    runMigrations(db);
    repoRepo = new RepoRepository(db);
    fileRepo = new FileRepository(db);
    symbolRepo = new SymbolRepository(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.exec('DELETE FROM symbol_references');
    db.exec('DELETE FROM symbols');
    db.exec('DELETE FROM files');
    db.exec('DELETE FROM repos');

    const repo = repoRepo.findOrCreate('/test/repo', 'test-repo');
    repoId = repo.id;

    // Seed: two files with symbols
    const f1 = fileRepo.upsert(repoId, 'app/Services/UserService.php', 'php', 'h1', 40);
    const f2 = fileRepo.upsert(repoId, 'app/Models/User.php', 'php', 'h2', 30);

    symbolRepo.replaceFileSymbols(f1.id, [
      makeClassWithMethods('UserService', 'App\\Services\\UserService', [
        { name: 'findById', line: 15 },
        { name: 'create', line: 25 },
      ]),
    ]);
    symbolRepo.replaceFileSymbols(f2.id, [
      makeClass('User', 'App\\Models\\User', 1, 30),
    ]);
  });

  describe('findByQualifiedName', () => {
    it('returns symbol for exact qualified name match', () => {
      const result = symbolRepo.findByQualifiedName(repoId, 'App\\Services\\UserService');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('UserService');
      expect(result!.kind).toBe('class');
    });

    it('returns null when no match', () => {
      const result = symbolRepo.findByQualifiedName(repoId, 'App\\Nonexistent');
      expect(result).toBeNull();
    });

    it('is scoped to repo — does not find symbols from other repos', () => {
      const other = repoRepo.findOrCreate('/other/repo', 'other');
      const result = symbolRepo.findByQualifiedName(other.id, 'App\\Services\\UserService');
      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns symbol by ID', () => {
      const known = symbolRepo.findByQualifiedName(repoId, 'App\\Models\\User');
      const result = symbolRepo.findById(known!.id);
      expect(result).not.toBeNull();
      expect(result!.qualifiedName).toBe('App\\Models\\User');
    });

    it('returns null for nonexistent ID', () => {
      const result = symbolRepo.findById(999999);
      expect(result).toBeNull();
    });
  });

  describe('search', () => {
    it('finds symbols by substring match (wraps in %)', () => {
      const results = symbolRepo.search(repoId, '%UserService%');
      // Should find the class + its two methods
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.name === 'UserService')).toBe(true);
    });

    it('finds symbols by suffix match', () => {
      const results = symbolRepo.search(repoId, '%User');
      expect(results.some(r => r.qualifiedName === 'App\\Models\\User')).toBe(true);
    });

    it('includes filePath in results', () => {
      const results = symbolRepo.search(repoId, '%UserService');
      const svc = results.find(r => r.name === 'UserService');
      expect(svc).toBeDefined();
      expect(svc!.filePath).toBe('app/Services/UserService.php');
    });

    it('filters by kind', () => {
      const results = symbolRepo.search(repoId, '%UserService%', 'method');
      expect(results.every(r => r.kind === 'method')).toBe(true);
      expect(results.length).toBe(2); // findById, create
    });

    it('respects limit', () => {
      const results = symbolRepo.search(repoId, '%', undefined, 1);
      expect(results).toHaveLength(1);
    });

    it('is case-insensitive', () => {
      const results = symbolRepo.search(repoId, '%userservice%');
      expect(results.some(r => r.name === 'UserService')).toBe(true);
    });

    it('is scoped to repo', () => {
      const other = repoRepo.findOrCreate('/other/repo', 'other');
      const results = symbolRepo.search(other.id, '%UserService%');
      expect(results).toHaveLength(0);
    });

    it('filters by file path prefix', () => {
      const results = symbolRepo.search(repoId, '%', undefined, 20, 'app/Services');
      expect(results.every(r => r.filePath.startsWith('app/Services'))).toBe(true);
      expect(results.some(r => r.name === 'UserService')).toBe(true);
    });

    it('path filter returns empty for non-matching path', () => {
      const results = symbolRepo.search(repoId, '%UserService%', undefined, 20, 'app/Controllers');
      expect(results).toHaveLength(0);
    });
  });

  describe('findByFilePath', () => {
    it('returns all symbols in a file', () => {
      const results = symbolRepo.findByFilePath(repoId, 'app/Services/UserService.php');
      expect(results).toHaveLength(3); // class + 2 methods
      expect(results[0].kind).toBe('class'); // ordered by line_start
    });

    it('returns empty array for unknown file', () => {
      const results = symbolRepo.findByFilePath(repoId, 'nonexistent.php');
      expect(results).toHaveLength(0);
    });

    it('is scoped to repo', () => {
      const other = repoRepo.findOrCreate('/other/repo', 'other');
      const results = symbolRepo.findByFilePath(other.id, 'app/Services/UserService.php');
      expect(results).toHaveLength(0);
    });
  });
});

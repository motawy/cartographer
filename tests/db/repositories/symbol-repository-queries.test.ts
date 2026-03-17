import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { RepoRepository } from '../../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../../src/db/repositories/symbol-repository.js';
import type { ParsedSymbol } from '../../../src/types.js';

const TEST_POOL_CONFIG = {
  host: 'localhost',
  port: 5435,
  database: 'cartograph_test',
  user: 'cartograph',
  password: 'localdev',
};

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
  let pool: pg.Pool;
  let repoRepo: RepoRepository;
  let fileRepo: FileRepository;
  let symbolRepo: SymbolRepository;
  let repoId: number;

  beforeAll(async () => {
    pool = new pg.Pool(TEST_POOL_CONFIG);
    repoRepo = new RepoRepository(pool);
    fileRepo = new FileRepository(pool);
    symbolRepo = new SymbolRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM symbol_references');
    await pool.query('DELETE FROM symbols');
    await pool.query('DELETE FROM files');
    await pool.query('DELETE FROM repos');

    const repo = await repoRepo.findOrCreate('/test/repo', 'test-repo');
    repoId = repo.id;

    // Seed: two files with symbols
    const f1 = await fileRepo.upsert(repoId, 'app/Services/UserService.php', 'php', 'h1', 40);
    const f2 = await fileRepo.upsert(repoId, 'app/Models/User.php', 'php', 'h2', 30);

    await symbolRepo.replaceFileSymbols(f1.id, [
      makeClassWithMethods('UserService', 'App\\Services\\UserService', [
        { name: 'findById', line: 15 },
        { name: 'create', line: 25 },
      ]),
    ]);
    await symbolRepo.replaceFileSymbols(f2.id, [
      makeClass('User', 'App\\Models\\User', 1, 30),
    ]);
  });

  describe('findByQualifiedName', () => {
    it('returns symbol for exact qualified name match', async () => {
      const result = await symbolRepo.findByQualifiedName(repoId, 'App\\Services\\UserService');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('UserService');
      expect(result!.kind).toBe('class');
    });

    it('returns null when no match', async () => {
      const result = await symbolRepo.findByQualifiedName(repoId, 'App\\Nonexistent');
      expect(result).toBeNull();
    });

    it('is scoped to repo — does not find symbols from other repos', async () => {
      const other = await repoRepo.findOrCreate('/other/repo', 'other');
      const result = await symbolRepo.findByQualifiedName(other.id, 'App\\Services\\UserService');
      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns symbol by ID', async () => {
      const known = await symbolRepo.findByQualifiedName(repoId, 'App\\Models\\User');
      const result = await symbolRepo.findById(known!.id);
      expect(result).not.toBeNull();
      expect(result!.qualifiedName).toBe('App\\Models\\User');
    });

    it('returns null for nonexistent ID', async () => {
      const result = await symbolRepo.findById(999999);
      expect(result).toBeNull();
    });
  });

  describe('search', () => {
    it('finds symbols by substring match (wraps in %)', async () => {
      const results = await symbolRepo.search(repoId, '%UserService%');
      // Should find the class + its two methods
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.name === 'UserService')).toBe(true);
    });

    it('finds symbols by suffix match', async () => {
      const results = await symbolRepo.search(repoId, '%User');
      expect(results.some(r => r.qualifiedName === 'App\\Models\\User')).toBe(true);
    });

    it('includes filePath in results', async () => {
      const results = await symbolRepo.search(repoId, '%UserService');
      const svc = results.find(r => r.name === 'UserService');
      expect(svc).toBeDefined();
      expect(svc!.filePath).toBe('app/Services/UserService.php');
    });

    it('filters by kind', async () => {
      const results = await symbolRepo.search(repoId, '%UserService%', 'method');
      expect(results.every(r => r.kind === 'method')).toBe(true);
      expect(results.length).toBe(2); // findById, create
    });

    it('respects limit', async () => {
      const results = await symbolRepo.search(repoId, '%', undefined, 1);
      expect(results).toHaveLength(1);
    });

    it('is case-insensitive', async () => {
      const results = await symbolRepo.search(repoId, '%userservice%');
      expect(results.some(r => r.name === 'UserService')).toBe(true);
    });

    it('is scoped to repo', async () => {
      const other = await repoRepo.findOrCreate('/other/repo', 'other');
      const results = await symbolRepo.search(other.id, '%UserService%');
      expect(results).toHaveLength(0);
    });

    it('filters by file path prefix', async () => {
      const results = await symbolRepo.search(repoId, '%', undefined, 20, 'app/Services');
      expect(results.every(r => r.filePath.startsWith('app/Services'))).toBe(true);
      expect(results.some(r => r.name === 'UserService')).toBe(true);
    });

    it('path filter returns empty for non-matching path', async () => {
      const results = await symbolRepo.search(repoId, '%UserService%', undefined, 20, 'app/Controllers');
      expect(results).toHaveLength(0);
    });
  });

  describe('findByFilePath', () => {
    it('returns all symbols in a file', async () => {
      const results = await symbolRepo.findByFilePath(repoId, 'app/Services/UserService.php');
      expect(results).toHaveLength(3); // class + 2 methods
      expect(results[0].kind).toBe('class'); // ordered by line_start
    });

    it('returns empty array for unknown file', async () => {
      const results = await symbolRepo.findByFilePath(repoId, 'nonexistent.php');
      expect(results).toHaveLength(0);
    });

    it('is scoped to repo', async () => {
      const other = await repoRepo.findOrCreate('/other/repo', 'other');
      const results = await symbolRepo.findByFilePath(other.id, 'app/Services/UserService.php');
      expect(results).toHaveLength(0);
    });
  });
});

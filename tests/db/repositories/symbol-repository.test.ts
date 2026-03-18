import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../../src/db/connection.js';
import { runMigrations } from '../../../src/db/migrate.js';
import { RepoRepository } from '../../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../../src/db/repositories/symbol-repository.js';
import type { ParsedSymbol } from '../../../src/types.js';

describe('SymbolRepository', () => {
  let db: Database.Database;
  let repoRepo: RepoRepository;
  let fileRepo: FileRepository;
  let symbolRepo: SymbolRepository;

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
  });

  it('stores and retrieves symbols with parent-child relationships', () => {
    const repo = repoRepo.findOrCreate('/test/repo', 'test-repo');
    const file = fileRepo.upsert(
      repo.id,
      'app/Services/UserService.php',
      'php',
      'abc123',
      50
    );

    const classSymbol: ParsedSymbol = {
      name: 'UserService',
      qualifiedName: 'App\\Services\\UserService',
      kind: 'class',
      visibility: null,
      lineStart: 8,
      lineEnd: 30,
      signature: null,
      returnType: null,
      docblock: null,
      children: [
        {
          name: 'findById',
          qualifiedName: 'App\\Services\\UserService::findById',
          kind: 'method',
          visibility: 'public',
          lineStart: 15,
          lineEnd: 18,
          signature: 'findById(int $id): ?User',
          returnType: '?User',
          docblock: '/** Find a user by ID. */',
          children: [],
          metadata: {},
        },
      ],
      metadata: {},
    };

    symbolRepo.replaceFileSymbols(file.id, [classSymbol]);

    const symbols = symbolRepo.findByFile(file.id);
    expect(symbols).toHaveLength(2); // class + method

    const cls = symbols.find((s) => s.kind === 'class');
    expect(cls?.qualifiedName).toBe('App\\Services\\UserService');
    expect(cls?.parentSymbolId).toBeNull();

    const method = symbols.find((s) => s.kind === 'method');
    expect(method?.qualifiedName).toBe(
      'App\\Services\\UserService::findById'
    );
    expect(method?.parentSymbolId).toBe(cls?.id);
    expect(method?.visibility).toBe('public');
    expect(method?.returnType).toBe('?User');
    expect(method?.docblock).toBe('/** Find a user by ID. */');
    expect(method?.signature).toBe('findById(int $id): ?User');
  });

  it('replaceFileSymbols is idempotent', () => {
    const repo = repoRepo.findOrCreate('/test/repo', 'test-repo');
    const file = fileRepo.upsert(repo.id, 'test.php', 'php', 'hash1', 10);

    const symbols: ParsedSymbol[] = [
      {
        name: 'Foo',
        qualifiedName: 'Foo',
        kind: 'class',
        visibility: null,
        lineStart: 1,
        lineEnd: 5,
        signature: null,
        returnType: null,
        docblock: null,
        children: [],
        metadata: {},
      },
    ];

    symbolRepo.replaceFileSymbols(file.id, symbols);
    symbolRepo.replaceFileSymbols(file.id, symbols);

    const result = symbolRepo.findByFile(file.id);
    expect(result).toHaveLength(1);
  });

  it('countByRepo returns total symbols across all files', () => {
    const repo = repoRepo.findOrCreate('/test/repo', 'test-repo');
    const f1 = fileRepo.upsert(repo.id, 'a.php', 'php', 'h1', 10);
    const f2 = fileRepo.upsert(repo.id, 'b.php', 'php', 'h2', 10);

    symbolRepo.replaceFileSymbols(f1.id, [
      {
        name: 'A',
        qualifiedName: 'A',
        kind: 'class',
        visibility: null,
        lineStart: 1,
        lineEnd: 5,
        signature: null,
        returnType: null,
        docblock: null,
        children: [],
        metadata: {},
      },
    ]);
    symbolRepo.replaceFileSymbols(f2.id, [
      {
        name: 'B',
        qualifiedName: 'B',
        kind: 'class',
        visibility: null,
        lineStart: 1,
        lineEnd: 5,
        signature: null,
        returnType: null,
        docblock: null,
        children: [],
        metadata: {},
      },
    ]);

    const count = symbolRepo.countByRepo(repo.id);
    expect(count).toBe(2);
  });

  it('stores and retrieves metadata as JSON', () => {
    const repo = repoRepo.findOrCreate('/test/repo', 'test-repo');
    const file = fileRepo.upsert(repo.id, 'c.php', 'php', 'h3', 10);

    symbolRepo.replaceFileSymbols(file.id, [
      {
        name: 'Bar',
        qualifiedName: 'Bar',
        kind: 'class',
        visibility: null,
        lineStart: 1,
        lineEnd: 10,
        signature: null,
        returnType: null,
        docblock: null,
        children: [],
        metadata: { extends: 'Foo', implements: ['Baz', 'Qux'] },
      },
    ]);

    const symbols = symbolRepo.findByFile(file.id);
    expect(symbols[0].metadata.extends).toBe('Foo');
    expect(symbols[0].metadata.implements).toEqual(['Baz', 'Qux']);
  });
});

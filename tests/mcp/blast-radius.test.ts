import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { ReferenceRepository } from '../../src/db/repositories/reference-repository.js';
import { handleBlastRadius } from '../../src/mcp/tools/blast-radius.js';
import type { ToolDeps } from '../../src/mcp/types.js';
import type { ParsedSymbol } from '../../src/types.js';

describe('cartograph_blast_radius', () => {
  let db: Database.Database;
  let deps: ToolDeps;

  beforeAll(() => {
    db = openDatabase({ path: ':memory:' });
    runMigrations(db);
    const repoRepo = new RepoRepository(db);
    const fileRepo = new FileRepository(db);
    const symbolRepo = new SymbolRepository(db);
    const refRepo = new ReferenceRepository(db);

    const repo = repoRepo.findOrCreate('/test/repo', 'test');

    // Target file: has a class with a method
    const f1 = fileRepo.upsert(repo.id, 'app/Services/UserService.php', 'php', 'h1', 40);
    // Dependent files
    const f2 = fileRepo.upsert(repo.id, 'app/Controllers/UserController.php', 'php', 'h2', 30);
    const f3 = fileRepo.upsert(repo.id, 'app/Jobs/SyncUsers.php', 'php', 'h3', 15);

    const svc: ParsedSymbol = {
      name: 'UserService', qualifiedName: 'App\\Services\\UserService',
      kind: 'class', visibility: null, lineStart: 1, lineEnd: 40,
      signature: null, returnType: null, docblock: null, metadata: {},
      children: [{
        name: 'create', qualifiedName: 'App\\Services\\UserService::create',
        kind: 'method', visibility: 'public', lineStart: 25, lineEnd: 30,
        signature: null, returnType: null, docblock: null, children: [], metadata: {},
      }],
    };

    const mkClass = (name: string, qn: string): ParsedSymbol => ({
      name, qualifiedName: qn, kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 10, signature: null, returnType: null,
      docblock: null, children: [], metadata: {},
    });

    symbolRepo.replaceFileSymbols(f1.id, [svc]);
    const ids2 = symbolRepo.replaceFileSymbols(f2.id, [mkClass('UserController', 'App\\Controllers\\UserController')]);
    const ids3 = symbolRepo.replaceFileSymbols(f3.id, [mkClass('SyncUsers', 'App\\Jobs\\SyncUsers')]);

    // Controller references UserService (the class), SyncUsers references UserService::create (the method)
    refRepo.replaceFileReferences(f2.id, ids2, [
      { sourceQualifiedName: 'App\\Controllers\\UserController', targetQualifiedName: 'app\\services\\userservice', kind: 'instantiation', line: 10 },
    ]);
    refRepo.replaceFileReferences(f3.id, ids3, [
      { sourceQualifiedName: 'App\\Jobs\\SyncUsers', targetQualifiedName: 'app\\services\\userservice::create', kind: 'static_call', line: 8 },
    ]);
    refRepo.resolveTargets(repo.id);

    deps = { repoId: repo.id, symbolRepo, refRepo };
  });

  afterAll(() => {
    db.close();
  });

  it('shows affected files and symbols', () => {
    const result = handleBlastRadius(deps, { file: 'app/Services/UserService.php' });
    expect(result).toContain('app/Controllers/UserController.php');
    expect(result).toContain('app/Jobs/SyncUsers.php');
    expect(result).toContain('Symbols in file:');
    expect(result).toContain('Affected');
  });

  it('returns not-found for unknown file', () => {
    const result = handleBlastRadius(deps, { file: 'nonexistent.php' });
    expect(result).toContain('not found');
  });

  it('returns no-impact message for file with no dependents', () => {
    const result = handleBlastRadius(deps, { file: 'app/Jobs/SyncUsers.php' });
    expect(result).toContain('No external dependents');
  });
});

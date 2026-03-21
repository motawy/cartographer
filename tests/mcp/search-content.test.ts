import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { ReferenceRepository } from '../../src/db/repositories/reference-repository.js';
import { handleSearchContent } from '../../src/mcp/tools/search-content.js';
import type { ToolDeps } from '../../src/mcp/types.js';
import type { ParsedSymbol } from '../../src/types.js';

describe('cartograph_search_content', () => {
  let db: Database.Database;
  let deps: ToolDeps;
  let tmpDir: string;

  beforeAll(() => {
    db = openDatabase({ path: ':memory:' });
    runMigrations(db);

    tmpDir = '/tmp/cartograph-search-content-test';
    mkdirSync(`${tmpDir}/app/Builders`, { recursive: true });
    writeFileSync(`${tmpDir}/app/Builders/RecurringJobBuilder.php`, [
      '<?php',
      'namespace App\\Builders;',
      'class RecurringJobBuilder {',
      '    protected function getReferenceID(): int',
      '    {',
      "        return (int) $this->args['recurringJobID'];",
      '    }',
      '}',
    ].join('\n'));

    const repoRepo = new RepoRepository(db);
    const fileRepo = new FileRepository(db);
    const symbolRepo = new SymbolRepository(db);
    const refRepo = new ReferenceRepository(db);
    const repo = repoRepo.findOrCreate(tmpDir, 'test-search-content');
    const file = fileRepo.upsert(repo.id, 'app/Builders/RecurringJobBuilder.php', 'php', 'h1', 8);

    const builder: ParsedSymbol = {
      name: 'RecurringJobBuilder',
      qualifiedName: 'App\\Builders\\RecurringJobBuilder',
      kind: 'class',
      visibility: null,
      lineStart: 3,
      lineEnd: 8,
      signature: null,
      returnType: null,
      docblock: null,
      metadata: {},
      children: [
        {
          name: 'getReferenceID',
          qualifiedName: 'App\\Builders\\RecurringJobBuilder::getReferenceID',
          kind: 'method',
          visibility: 'protected',
          lineStart: 4,
          lineEnd: 7,
          signature: 'getReferenceID(): int',
          returnType: 'int',
          docblock: null,
          metadata: {},
          children: [],
        },
      ],
    };

    symbolRepo.replaceFileSymbols(file.id, [builder]);

    deps = {
      repoId: repo.id,
      repoPath: tmpDir,
      fileRepo,
      symbolRepo,
      refRepo,
    };
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    db.close();
  });

  it('finds matching content and maps it to an enclosing symbol', () => {
    const result = handleSearchContent(deps, { query: "recurringJobID" });
    expect(result).toContain('## Content Search');
    expect(result).toContain('App\\Builders\\RecurringJobBuilder::getReferenceID');
    expect(result).toContain("return (int) $this->args['recurringJobID'];");
  });

  it('respects path filters', () => {
    const result = handleSearchContent(deps, {
      query: 'RecurringJobBuilder',
      path: 'app/Builders',
    });
    expect(result).toContain('Path filter: app/Builders');
    expect(result).toContain('RecurringJobBuilder');
  });

  it('returns a no-results message', () => {
    const result = handleSearchContent(deps, { query: 'totally_missing_string' });
    expect(result).toContain('No indexed content matches');
  });
});

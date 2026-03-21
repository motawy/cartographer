import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../src/db/repositories/symbol-repository.js';
import { renderSearchContentForRepo } from '../../src/cli/search-content.js';
import type { ParsedSymbol } from '../../src/types.js';

describe('renderSearchContentForRepo', () => {
  it('renders content matches for an indexed repo', () => {
    const db = openDatabase({ path: ':memory:' });
    const tmpDir = '/tmp/cartograph-cli-search-content-test';

    try {
      runMigrations(db);
      mkdirSync(`${tmpDir}/app`, { recursive: true });
      writeFileSync(`${tmpDir}/app/Foo.php`, [
        '<?php',
        'class Foo {',
        '    public function run(): void',
        '    {',
        "        $this->args['jobID'] = 1;",
        '    }',
        '}',
      ].join('\n'));

      const repoRepo = new RepoRepository(db);
      const fileRepo = new FileRepository(db);
      const symbolRepo = new SymbolRepository(db);
      const repo = repoRepo.findOrCreate(tmpDir, 'test');
      const file = fileRepo.upsert(repo.id, 'app/Foo.php', 'php', 'h1', 7);

      const foo: ParsedSymbol = {
        name: 'Foo',
        qualifiedName: 'App\\Foo',
        kind: 'class',
        visibility: null,
        lineStart: 2,
        lineEnd: 7,
        signature: null,
        returnType: null,
        docblock: null,
        metadata: {},
        children: [
          {
            name: 'run',
            qualifiedName: 'App\\Foo::run',
            kind: 'method',
            visibility: 'public',
            lineStart: 3,
            lineEnd: 6,
            signature: 'run(): void',
            returnType: 'void',
            docblock: null,
            metadata: {},
            children: [],
          },
        ],
      };

      symbolRepo.replaceFileSymbols(file.id, [foo]);

      const result = renderSearchContentForRepo(db, tmpDir, 'jobID');
      expect(result).toContain('App\\Foo::run');
      expect(result).toContain("app/Foo.php:5");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
      db.close();
    }
  });
});

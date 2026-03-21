import { describe, it, expect } from 'vitest';
import { discoverFiles } from '../../src/indexer/file-walker.js';
import { join } from 'path';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import type { CartographConfig } from '../../src/types.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'laravel-sample');

function makeConfig(overrides: Partial<CartographConfig> = {}): CartographConfig {
  return {
    languages: ['php'],
    exclude: ['vendor/'],
    database: { path: ':memory:' },
    ...overrides,
  };
}

describe('File Walker', () => {
  it('discovers all PHP files in fixture project', () => {
    const files = discoverFiles(FIXTURES_DIR, makeConfig());

    expect(files).toHaveLength(6);
    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toEqual([
      'app/Contracts/UserServiceInterface.php',
      'app/Http/Controllers/UserController.php',
      'app/Models/User.php',
      'app/Repositories/UserRepository.php',
      'app/Services/UserService.php',
      'app/Traits/HasTimestamps.php',
    ]);
  });

  it('computes SHA-256 hashes (64-char hex)', () => {
    const files = discoverFiles(FIXTURES_DIR, makeConfig());

    for (const file of files) {
      expect(file.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('sets language to php for .php files', () => {
    const files = discoverFiles(FIXTURES_DIR, makeConfig());
    expect(files.every((f) => f.language === 'php')).toBe(true);
  });

  it('respects exclude patterns', () => {
    const files = discoverFiles(
      FIXTURES_DIR,
      makeConfig({ exclude: ['vendor/', 'app/Models/'] })
    );

    const paths = files.map((f) => f.relativePath);
    expect(paths.every((p) => !p.startsWith('app/Models/'))).toBe(true);
    expect(paths).not.toContain('app/Models/User.php');
  });

  it('returns both relative and absolute paths', () => {
    const files = discoverFiles(FIXTURES_DIR, makeConfig());

    for (const file of files) {
      expect(file.absolutePath.startsWith(FIXTURES_DIR)).toBe(true);
      expect(file.relativePath).not.toContain(FIXTURES_DIR);
      expect(file.absolutePath.endsWith(file.relativePath)).toBe(true);
    }
  });

  it('filters by configured languages', () => {
    const files = discoverFiles(
      FIXTURES_DIR,
      makeConfig({ languages: ['typescript'] })
    );
    expect(files).toHaveLength(0);
  });

  it('produces stable hashes for unchanged files', () => {
    const first = discoverFiles(FIXTURES_DIR, makeConfig());
    const second = discoverFiles(FIXTURES_DIR, makeConfig());

    for (let i = 0; i < first.length; i++) {
      expect(first[i].hash).toBe(second[i].hash);
    }
  });

  it('supplements git discovery with source files present on disk', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'cartograph-file-walker-'));

    try {
      execSync('git init', { cwd: repoDir, stdio: 'ignore' });

      writeFileSync(join(repoDir, '.gitignore'), 'ignored/\n');
      writeFileSync(join(repoDir, 'tracked.php'), '<?php class Tracked {}');
      mkdirSync(join(repoDir, 'ignored'), { recursive: true });
      writeFileSync(join(repoDir, 'ignored', 'extra.php'), '<?php class Extra {}');

      execSync('git add .gitignore tracked.php', { cwd: repoDir, stdio: 'ignore' });

      const files = discoverFiles(repoDir, makeConfig({ exclude: [] }));
      const paths = files.map((file) => file.relativePath).sort();

      expect(paths).toEqual(['ignored/extra.php', 'tracked.php']);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

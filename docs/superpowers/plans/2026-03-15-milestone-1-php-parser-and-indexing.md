# Milestone 1: PHP Parser & Symbol Indexing — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse PHP codebases with Tree-sitter, extract symbols (classes, methods, functions, properties, constants), resolve namespaces, and store everything in PostgreSQL. `cartograph index <repo-path>` works end-to-end on a Laravel project.

**Architecture:** CLI command triggers a synchronous pipeline: file walker discovers PHP files (respecting .gitignore + config excludes) → computes content hashes for change detection → Tree-sitter parser extracts AST → PHP-specific extractor pulls symbols with namespace resolution → repository layer upserts to PostgreSQL. Each module is independent with clear interfaces. DI for all database/external dependencies. No singletons.

**Tech Stack:** TypeScript (strict, ESM), Node.js 22, Commander.js, tree-sitter + tree-sitter-php (native bindings), PostgreSQL 16 via pgvector Docker image, Vitest, pg (node-postgres)

---

## Design Notes

**`repos` table addition:** The README schema uses `repo_id` in `files` but never defines a `repos` table. We add one — makes the FK explicit, supports multi-repo, gives us a place for per-repo metadata.

**No `symbol-extractor.ts`:** The README lists it separately, but `ast-parser.ts` (orchestrator) + `parsers/php.ts` (language-specific extraction) is sufficient. A third file adds indirection without value.

**Custom migration runner:** Raw SQL files + a ~40-line TypeScript runner. Matches the project's simplicity goals and the CLAUDE.md convention of "numbered sequentially." No `node-pg-migrate` dependency needed for DDL-only migrations.

**Config simplicity:** For Milestone 1, config supports `languages`, `exclude`, and `database` only. The full `.cartograph.yml` schema (embedding, llm, output, mcp sections) comes in later milestones. YAGNI.

**No `code_embeddings` or `project_profiles` tables yet.** Those belong to Milestones 6 and 4 respectively.

---

## File Structure

```
package.json
tsconfig.json
vitest.config.ts
.gitignore
.env.example
docker-compose.yml
src/
  cli/
    main.ts                         — Commander.js entry point, registers subcommands
    index.ts                        — `cartograph index` command handler
  config.ts                         — Config loader (.cartograph.yml + env defaults)
  errors.ts                         — Typed error classes (IndexError, ParseError, DatabaseError)
  types.ts                          — Shared interfaces (DiscoveredFile, ParsedSymbol, etc.)
  indexer/
    file-walker.ts                  — Git-aware file discovery with hash computation
    ast-parser.ts                   — Tree-sitter orchestrator, delegates to language parsers
    parsers/
      php.ts                        — PHP symbol extraction: classes, methods, namespaces
    pipeline.ts                     — Indexing pipeline: discover → parse → store
  db/
    connection.ts                   — PostgreSQL pool factory (DI-friendly)
    migrate.ts                      — Simple migration runner (raw SQL files)
    migrations/
      001_create-repos.sql
      002_create-files.sql
      003_create-symbols.sql
      004_create-symbol-references.sql
    repositories/
      repo-repository.ts            — CRUD for repos table
      file-repository.ts            — CRUD + hash comparison for files table
      symbol-repository.ts          — Bulk upsert with parent-child handling
tests/
  setup.ts                          — Global test setup (create test DB, run migrations)
  fixtures/
    laravel-sample/
      app/Models/User.php
      app/Services/UserService.php
      app/Http/Controllers/UserController.php
      app/Repositories/UserRepository.php
      composer.json
  indexer/
    file-walker.test.ts
    parsers/
      php.test.ts
  integration/
    index-command.test.ts
scripts/
  explore-ast.ts                    — One-off script to print PHP AST structure
```

---

## Chunk 1: Project Foundation

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/errors.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize project and install dependencies**

```bash
cd /Users/mido/Desktop/personal/cargographer
npm init -y
```

Then update `package.json`:

```json
{
  "name": "cartograph",
  "version": "0.1.0",
  "description": "Map your codebase so AI can navigate it",
  "type": "module",
  "bin": {
    "cartograph": "./dist/cli/main.js"
  },
  "scripts": {
    "dev": "tsx src/cli/main.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run tests/integration",
    "migrate": "tsx src/db/migrate.ts"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

Install dependencies:

```bash
npm install commander pg yaml ignore fast-glob dotenv tree-sitter tree-sitter-php
npm install -D typescript @types/node @types/pg vitest tsx
```

> **Note:** `tree-sitter` requires native compilation (N-API). If `npm install` fails on tree-sitter, ensure Xcode Command Line Tools are installed: `xcode-select --install`. Node 22 + macOS ARM64 should work out of the box.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup.ts'],
    testTimeout: 30000,
  },
});
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.env
*.tsbuildinfo
coverage/
.DS_Store
```

- [ ] **Step 5: Create .env.example**

```
CARTOGRAPH_DB_HOST=localhost
CARTOGRAPH_DB_PORT=5432
CARTOGRAPH_DB_NAME=cartograph
CARTOGRAPH_DB_USER=cartograph
CARTOGRAPH_DB_PASSWORD=localdev
```

- [ ] **Step 6: Create src/errors.ts**

```typescript
export class CartographError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CartographError';
  }
}

export class IndexError extends CartographError {
  constructor(message: string) {
    super(message, 'INDEX_ERROR');
    this.name = 'IndexError';
  }
}

export class ParseError extends CartographError {
  constructor(message: string, public readonly filePath: string) {
    super(`${message} (file: ${filePath})`, 'PARSE_ERROR');
    this.name = 'ParseError';
  }
}

export class DatabaseError extends CartographError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}
```

- [ ] **Step 7: Create src/types.ts**

```typescript
export type SymbolKind =
  | 'class'
  | 'interface'
  | 'trait'
  | 'method'
  | 'function'
  | 'property'
  | 'constant'
  | 'enum';

export type Visibility = 'public' | 'protected' | 'private';

export interface DiscoveredFile {
  relativePath: string;
  absolutePath: string;
  language: string;
  hash: string;
}

export interface ParsedSymbol {
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  visibility: Visibility | null;
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  returnType: string | null;
  docblock: string | null;
  children: ParsedSymbol[];
  metadata: Record<string, unknown>;
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  namespace: string | null;
  imports: Map<string, string>;
}

export interface CartographConfig {
  languages: string[];
  exclude: string[];
  database: DatabaseConfig;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}
```

- [ ] **Step 8: Verify project builds**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example src/errors.ts src/types.ts
git commit -m "[scaffold]: project setup with TypeScript, Vitest, and core types"
```

---

### Task 2: Docker + Database Infrastructure

**Files:**
- Create: `docker-compose.yml`
- Create: `src/db/connection.ts`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: cartograph
      POSTGRES_USER: cartograph
      POSTGRES_PASSWORD: localdev
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cartograph"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

- [ ] **Step 2: Start Docker and verify**

```bash
docker compose up -d
docker compose ps
```

Expected: both containers running, postgres healthy.

- [ ] **Step 3: Create src/db/connection.ts**

```typescript
import pg from 'pg';
import type { DatabaseConfig } from '../types.js';

export function createPool(config: DatabaseConfig): pg.Pool {
  return new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.name,
    user: config.user,
    password: config.password,
    max: 10,
  });
}
```

- [ ] **Step 4: Verify connection works**

Quick test via tsx:

```bash
npx tsx -e "
import pg from 'pg';
const pool = new pg.Pool({ host:'localhost', port:5432, database:'cartograph', user:'cartograph', password:'localdev' });
const { rows } = await pool.query('SELECT NOW()');
console.log('Connected:', rows[0].now);
await pool.end();
"
```

Expected: prints current timestamp.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml src/db/connection.ts
git commit -m "[infra]: Docker Compose with PostgreSQL 16 (pgvector) and Redis"
```

---

### Task 3: Database Migrations

**Files:**
- Create: `src/db/migrate.ts`
- Create: `src/db/migrations/001_create-repos.sql`
- Create: `src/db/migrations/002_create-files.sql`
- Create: `src/db/migrations/003_create-symbols.sql`
- Create: `src/db/migrations/004_create-symbol-references.sql`

- [ ] **Step 1: Create migration runner**

```typescript
// src/db/migrate.ts
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query('SELECT name FROM _migrations ORDER BY name');
  const applied = new Set(rows.map((r: { name: string }) => r.name));

  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  Applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

// Allow running directly: npx tsx src/db/migrate.ts
const isDirectRun = process.argv[1]?.endsWith('migrate.ts');
if (isDirectRun) {
  const pool = new pg.Pool({
    host: process.env.CARTOGRAPH_DB_HOST || 'localhost',
    port: parseInt(process.env.CARTOGRAPH_DB_PORT || '5432'),
    database: process.env.CARTOGRAPH_DB_NAME || 'cartograph',
    user: process.env.CARTOGRAPH_DB_USER || 'cartograph',
    password: process.env.CARTOGRAPH_DB_PASSWORD || 'localdev',
  });

  console.log('Running migrations...');
  await runMigrations(pool);
  console.log('Done.');
  await pool.end();
}
```

- [ ] **Step 2: Create 001_create-repos.sql**

```sql
CREATE TABLE repos (
    id              SERIAL PRIMARY KEY,
    path            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_indexed_at TIMESTAMPTZ
);
```

- [ ] **Step 3: Create 002_create-files.sql**

```sql
CREATE TABLE files (
    id              SERIAL PRIMARY KEY,
    repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    path            TEXT NOT NULL,
    language        VARCHAR(32) NOT NULL,
    hash            VARCHAR(64) NOT NULL,
    last_indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lines_of_code   INTEGER,
    UNIQUE(repo_id, path)
);

CREATE INDEX idx_files_repo_id ON files(repo_id);
```

- [ ] **Step 4: Create 003_create-symbols.sql**

```sql
CREATE TABLE symbols (
    id               SERIAL PRIMARY KEY,
    file_id          INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    kind             VARCHAR(32) NOT NULL,
    name             TEXT NOT NULL,
    qualified_name   TEXT,
    visibility       VARCHAR(16),
    parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
    line_start       INTEGER NOT NULL,
    line_end         INTEGER NOT NULL,
    signature        TEXT,
    return_type      TEXT,
    docblock         TEXT,
    metadata         JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_symbols_file_id ON symbols(file_id);
CREATE INDEX idx_symbols_qualified_name ON symbols(qualified_name);
CREATE INDEX idx_symbols_kind ON symbols(kind);
CREATE INDEX idx_symbols_parent ON symbols(parent_symbol_id);
```

- [ ] **Step 5: Create 004_create-symbol-references.sql**

```sql
-- Table created now, populated in Milestone 2 (dependency tracing)
CREATE TABLE symbol_references (
    id                    SERIAL PRIMARY KEY,
    source_symbol_id      INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    target_qualified_name TEXT NOT NULL,
    target_symbol_id      INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
    reference_kind        VARCHAR(32),
    line_number           INTEGER
);

CREATE INDEX idx_refs_source ON symbol_references(source_symbol_id);
CREATE INDEX idx_refs_target ON symbol_references(target_symbol_id);
CREATE INDEX idx_refs_target_name ON symbol_references(target_qualified_name);
```

- [ ] **Step 6: Run migrations and verify**

```bash
npm run migrate
```

Expected output:
```
Running migrations...
  Applied: 001_create-repos.sql
  Applied: 002_create-files.sql
  Applied: 003_create-symbols.sql
  Applied: 004_create-symbol-references.sql
Done.
```

Verify tables exist:

```bash
docker compose exec postgres psql -U cartograph -c "\dt"
```

Expected: tables `_migrations`, `repos`, `files`, `symbols`, `symbol_references` listed.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrate.ts src/db/migrations/
git commit -m "[db]: migration runner and initial schema (repos, files, symbols, symbol_references)"
```

---

## Chunk 2: File Discovery

### Task 4: Test Fixtures

**Files:**
- Create: `tests/fixtures/laravel-sample/app/Models/User.php`
- Create: `tests/fixtures/laravel-sample/app/Services/UserService.php`
- Create: `tests/fixtures/laravel-sample/app/Http/Controllers/UserController.php`
- Create: `tests/fixtures/laravel-sample/app/Repositories/UserRepository.php`
- Create: `tests/fixtures/laravel-sample/composer.json`

These fixtures must be realistic PHP with namespaces, use statements, type hints, docblocks, constants, properties, visibility modifiers, and inheritance — all the things the parser needs to handle.

- [ ] **Step 1: Create User.php model**

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * User model representing an application user.
 */
class User extends Model implements Authenticatable
{
    const STATUS_ACTIVE = 'active';
    const STATUS_INACTIVE = 'inactive';

    protected string $table = 'users';

    protected array $fillable = [
        'name',
        'email',
        'password',
    ];

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }
}
```

- [ ] **Step 2: Create UserService.php**

```php
<?php

namespace App\Services;

use App\Models\User;
use App\Repositories\UserRepository;

class UserService
{
    private UserRepository $userRepo;

    public function __construct(UserRepository $userRepo)
    {
        $this->userRepo = $userRepo;
    }

    /**
     * Find a user by their ID.
     */
    public function findById(int $id): ?User
    {
        return $this->userRepo->find($id);
    }

    public function create(array $data): User
    {
        return $this->userRepo->create($data);
    }

    public function update(int $id, array $data): User
    {
        $user = $this->findById($id);
        if (!$user) {
            throw new \RuntimeException("User not found: {$id}");
        }
        return $this->userRepo->update($user, $data);
    }
}
```

- [ ] **Step 3: Create UserController.php**

```php
<?php

namespace App\Http\Controllers;

use App\Services\UserService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class UserController extends Controller
{
    public function __construct(
        private readonly UserService $userService
    ) {}

    public function show(int $id): JsonResponse
    {
        $user = $this->userService->findById($id);
        return response()->json($user);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $this->userService->create($request->validated());
        return response()->json($user, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $this->userService->update($id, $request->validated());
        return response()->json($user);
    }
}
```

- [ ] **Step 4: Create UserRepository.php**

```php
<?php

namespace App\Repositories;

use App\Models\User;

class UserRepository
{
    public function find(int $id): ?User
    {
        return User::find($id);
    }

    public function create(array $data): User
    {
        return User::create($data);
    }

    public function update(User $user, array $data): User
    {
        $user->update($data);
        return $user->fresh();
    }

    public function delete(User $user): bool
    {
        return $user->delete();
    }
}
```

- [ ] **Step 5: Create composer.json (minimal)**

```json
{
  "name": "test/laravel-sample",
  "autoload": {
    "psr-4": {
      "App\\": "app/"
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/
git commit -m "[test]: PHP fixture project (mini Laravel with models, services, controllers, repos)"
```

---

### Task 5: File Walker

**Files:**
- Create: `src/config.ts`
- Create: `src/indexer/file-walker.ts`
- Test: `tests/indexer/file-walker.test.ts`

- [ ] **Step 1: Create src/config.ts**

```typescript
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { CartographConfig } from './types.js';

const DEFAULT_EXCLUDES = ['vendor/', 'node_modules/', '.git/'];

export function loadConfig(repoPath: string): CartographConfig {
  const configPath = join(repoPath, '.cartograph.yml');

  const defaults: CartographConfig = {
    languages: ['php'],
    exclude: DEFAULT_EXCLUDES,
    database: {
      host: process.env.CARTOGRAPH_DB_HOST || 'localhost',
      port: parseInt(process.env.CARTOGRAPH_DB_PORT || '5432'),
      name: process.env.CARTOGRAPH_DB_NAME || 'cartograph',
      user: process.env.CARTOGRAPH_DB_USER || 'cartograph',
      password: process.env.CARTOGRAPH_DB_PASSWORD || 'localdev',
    },
  };

  if (!existsSync(configPath)) {
    return defaults;
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);

  return {
    languages: parsed?.languages || defaults.languages,
    exclude: parsed?.exclude
      ? [...DEFAULT_EXCLUDES, ...parsed.exclude]
      : defaults.exclude,
    database: { ...defaults.database, ...(parsed?.database || {}) },
  };
}
```

- [ ] **Step 2: Write failing file walker tests**

```typescript
// tests/indexer/file-walker.test.ts
import { describe, it, expect } from 'vitest';
import { discoverFiles } from '../../src/indexer/file-walker.js';
import { join } from 'path';
import type { CartographConfig } from '../../src/types.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'laravel-sample');

function makeConfig(overrides: Partial<CartographConfig> = {}): CartographConfig {
  return {
    languages: ['php'],
    exclude: ['vendor/'],
    database: { host: '', port: 0, name: '', user: '', password: '' },
    ...overrides,
  };
}

describe('File Walker', () => {
  it('discovers all PHP files in fixture project', async () => {
    const files = await discoverFiles(FIXTURES_DIR, makeConfig());

    expect(files).toHaveLength(4);
    const paths = files.map(f => f.relativePath).sort();
    expect(paths).toEqual([
      'app/Http/Controllers/UserController.php',
      'app/Models/User.php',
      'app/Repositories/UserRepository.php',
      'app/Services/UserService.php',
    ]);
  });

  it('computes SHA-256 hashes (64-char hex)', async () => {
    const files = await discoverFiles(FIXTURES_DIR, makeConfig());

    for (const file of files) {
      expect(file.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('sets language to php for .php files', async () => {
    const files = await discoverFiles(FIXTURES_DIR, makeConfig());
    expect(files.every(f => f.language === 'php')).toBe(true);
  });

  it('respects exclude patterns', async () => {
    const files = await discoverFiles(
      FIXTURES_DIR,
      makeConfig({ exclude: ['vendor/', 'app/Models/'] })
    );

    const paths = files.map(f => f.relativePath);
    expect(paths.every(p => !p.startsWith('app/Models/'))).toBe(true);
    expect(paths).not.toContain('app/Models/User.php');
  });

  it('returns both relative and absolute paths', async () => {
    const files = await discoverFiles(FIXTURES_DIR, makeConfig());

    for (const file of files) {
      expect(file.absolutePath.startsWith(FIXTURES_DIR)).toBe(true);
      expect(file.relativePath).not.toContain(FIXTURES_DIR);
      expect(file.absolutePath.endsWith(file.relativePath)).toBe(true);
    }
  });

  it('filters by configured languages', async () => {
    // typescript not present in fixture, should return 0 files
    const files = await discoverFiles(
      FIXTURES_DIR,
      makeConfig({ languages: ['typescript'] })
    );
    expect(files).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/indexer/file-walker.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 4: Implement file walker**

```typescript
// src/indexer/file-walker.ts
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, extname } from 'path';
import ignore from 'ignore';
import fg from 'fast-glob';
import type { DiscoveredFile, CartographConfig } from '../types.js';

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.php': 'php',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.go': 'go',
};

export async function discoverFiles(
  repoPath: string,
  config: CartographConfig
): Promise<DiscoveredFile[]> {
  const allowedExtensions = new Set(
    Object.entries(LANGUAGE_EXTENSIONS)
      .filter(([, lang]) => config.languages.includes(lang))
      .map(([ext]) => ext)
  );

  let filePaths: string[];

  try {
    const output = execSync(
      'git ls-files --cached --others --exclude-standard',
      { cwd: repoPath, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );
    filePaths = output.trim().split('\n').filter(Boolean);
  } catch {
    filePaths = await fg('**/*', {
      cwd: repoPath,
      ignore: config.exclude,
      dot: false,
    });
  }

  // Apply config excludes
  const ig = ignore().add(config.exclude);
  filePaths = filePaths.filter(p => !ig.ignores(p));

  const files: DiscoveredFile[] = [];

  for (const relativePath of filePaths) {
    const ext = extname(relativePath);
    if (!allowedExtensions.has(ext)) continue;

    const language = LANGUAGE_EXTENSIONS[ext]!;
    const absolutePath = join(repoPath, relativePath);

    try {
      const content = readFileSync(absolutePath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      files.push({ relativePath, absolutePath, language, hash });
    } catch {
      // Skip unreadable files
      continue;
    }
  }

  return files;
}
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
npx vitest run tests/indexer/file-walker.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/indexer/file-walker.ts tests/indexer/file-walker.test.ts
git commit -m "[feat]: file walker with .gitignore support, content hashing, and config loader"
```

---

## Chunk 3: PHP Parser

### Task 6: AST Exploration + Tree-sitter Setup

**Files:**
- Create: `scripts/explore-ast.ts`
- Create: `src/indexer/ast-parser.ts`

This is a critical discovery step. Tree-sitter grammar node types vary by version. We print the actual AST of our fixture PHP and verify node type names before writing extraction code.

- [ ] **Step 1: Create AST exploration script**

```typescript
// scripts/explore-ast.ts
import Parser from 'tree-sitter';

// The import for tree-sitter-php varies by version.
// Try: import PHP from 'tree-sitter-php'  (then use PHP.php or PHP directly)
// This step discovers the correct import and node types.
import PHP from 'tree-sitter-php';

const parser = new Parser();

// Try PHP.php first (wrapper with <?php tag support), fall back to PHP directly
const language = (PHP as any).php || PHP;
parser.setLanguage(language);

const source = `<?php

namespace App\\Services;

use App\\Models\\User;
use App\\Repositories\\UserRepository;

class UserService
{
    const MAX_RESULTS = 100;

    private UserRepository $userRepo;

    public function __construct(UserRepository $userRepo)
    {
        $this->userRepo = $userRepo;
    }

    /**
     * Find a user by ID.
     */
    public function findById(int $id): ?User
    {
        return $this->userRepo->find($id);
    }
}
`;

const tree = parser.parse(source);

function printTree(node: Parser.SyntaxNode, indent = 0): void {
  const prefix = '  '.repeat(indent);
  const field = node.parent?.children
    ? ''
    : '';
  const text = node.childCount === 0 ? ` "${node.text}"` : '';
  console.log(
    `${prefix}${node.type} [${node.startPosition.row}:${node.startPosition.column}..${node.endPosition.row}:${node.endPosition.column}]${text}`
  );
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    printTree(child, indent + 1);
  }
}

printTree(tree.rootNode);
```

- [ ] **Step 2: Run the exploration script**

```bash
npx tsx scripts/explore-ast.ts
```

Study the output carefully. Note the exact node types for:
- `namespace_definition` and its name child
- `namespace_use_declaration` and its clause structure
- `class_declaration`, its name, base_clause, class_interface_clause, declaration_list
- `method_declaration`, visibility_modifier, formal_parameters, return type
- `property_declaration`, visibility_modifier, variable_name, type
- `const_declaration` and `const_element`
- Where `comment` nodes appear relative to classes/methods (for docblock extraction)

**If node types differ from what's assumed in the plan, adjust the parser implementation in Tasks 7-8 accordingly.**

- [ ] **Step 3: Create src/indexer/ast-parser.ts (orchestrator)**

```typescript
// src/indexer/ast-parser.ts
import Parser from 'tree-sitter';
import PHP from 'tree-sitter-php';
import { readFileSync } from 'fs';
import type { DiscoveredFile, ParsedSymbol } from '../types.js';
import { parsePHP } from './parsers/php.js';
import { ParseError } from '../errors.js';

export interface AstParseResult {
  symbols: ParsedSymbol[];
  linesOfCode: number;
}

export class AstParser {
  private phpParser: Parser;

  constructor() {
    this.phpParser = new Parser();
    // Adjust based on explore-ast.ts findings
    const language = (PHP as any).php || PHP;
    this.phpParser.setLanguage(language);
  }

  parse(file: DiscoveredFile): AstParseResult {
    const source = readFileSync(file.absolutePath, 'utf-8');
    const linesOfCode = source.split('\n').length;

    switch (file.language) {
      case 'php': {
        const result = parsePHP(source, this.phpParser);
        return { symbols: result.symbols, linesOfCode };
      }
      default:
        throw new ParseError(
          `Unsupported language: ${file.language}`,
          file.relativePath
        );
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add scripts/explore-ast.ts src/indexer/ast-parser.ts
git commit -m "[feat]: tree-sitter setup with AST exploration script"
```

---

### Task 7: PHP Symbol Extraction

**Files:**
- Create: `src/indexer/parsers/php.ts`
- Test: `tests/indexer/parsers/php.test.ts`

> **Important:** The node types below are based on typical tree-sitter-php grammar. After running `explore-ast.ts` (Task 6 Step 2), adjust any node type names that differ.

- [ ] **Step 1: Write failing PHP parser tests**

```typescript
// tests/indexer/parsers/php.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'tree-sitter';
import PHP from 'tree-sitter-php';
import { parsePHP } from '../../src/indexer/parsers/php.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'laravel-sample');

describe('PHP Parser', () => {
  let parser: Parser;

  beforeAll(() => {
    parser = new Parser();
    const language = (PHP as any).php || PHP;
    parser.setLanguage(language);
  });

  describe('class extraction', () => {
    it('extracts class with correct qualified name', () => {
      const source = readFileSync(join(FIXTURES, 'app/Models/User.php'), 'utf-8');
      const result = parsePHP(source, parser);

      expect(result.namespace).toBe('App\\Models');
      const classes = result.symbols.filter(s => s.kind === 'class');
      expect(classes).toHaveLength(1);

      const user = classes[0];
      expect(user.name).toBe('User');
      expect(user.qualifiedName).toBe('App\\Models\\User');
    });

    it('extracts extends and implements from class', () => {
      const source = readFileSync(join(FIXTURES, 'app/Models/User.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const user = result.symbols[0];

      // Model is imported via `use Illuminate\Database\Eloquent\Model`
      expect(user.metadata.extends).toBe('Illuminate\\Database\\Eloquent\\Model');
      expect(user.metadata.implements).toContain(
        'Illuminate\\Contracts\\Auth\\Authenticatable'
      );
    });

    it('extracts line range for class', () => {
      const source = readFileSync(join(FIXTURES, 'app/Models/User.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const user = result.symbols[0];

      expect(user.lineStart).toBeGreaterThan(0);
      expect(user.lineEnd).toBeGreaterThan(user.lineStart);
    });
  });

  describe('method extraction', () => {
    it('extracts methods as children of class', () => {
      const source = readFileSync(join(FIXTURES, 'app/Services/UserService.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const service = result.symbols[0];

      const methods = service.children.filter(c => c.kind === 'method');
      const methodNames = methods.map(m => m.name);
      expect(methodNames).toContain('__construct');
      expect(methodNames).toContain('findById');
      expect(methodNames).toContain('create');
      expect(methodNames).toContain('update');
    });

    it('extracts method qualified names', () => {
      const source = readFileSync(join(FIXTURES, 'app/Services/UserService.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const service = result.symbols[0];

      const findById = service.children.find(c => c.name === 'findById');
      expect(findById?.qualifiedName).toBe('App\\Services\\UserService::findById');
    });

    it('extracts method visibility', () => {
      const source = readFileSync(join(FIXTURES, 'app/Services/UserService.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const service = result.symbols[0];

      const findById = service.children.find(c => c.name === 'findById');
      expect(findById?.visibility).toBe('public');

      const constructor = service.children.find(c => c.name === '__construct');
      expect(constructor?.visibility).toBe('public');
    });

    it('extracts return types', () => {
      const source = readFileSync(join(FIXTURES, 'app/Services/UserService.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const service = result.symbols[0];

      const findById = service.children.find(c => c.name === 'findById');
      // Return type should contain User (might be ?User or nullable representation)
      expect(findById?.returnType).toBeTruthy();

      const create = service.children.find(c => c.name === 'create');
      expect(create?.returnType).toBeTruthy();
    });

    it('flags magic methods in metadata', () => {
      const source = readFileSync(join(FIXTURES, 'app/Services/UserService.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const service = result.symbols[0];

      const constructor = service.children.find(c => c.name === '__construct');
      expect(constructor?.metadata.magic).toBe(true);
    });
  });

  describe('property extraction', () => {
    it('extracts properties with visibility and type', () => {
      const source = readFileSync(join(FIXTURES, 'app/Services/UserService.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const service = result.symbols[0];

      const props = service.children.filter(c => c.kind === 'property');
      const userRepo = props.find(p => p.name === 'userRepo');
      expect(userRepo).toBeDefined();
      expect(userRepo?.visibility).toBe('private');
      expect(userRepo?.qualifiedName).toBe('App\\Services\\UserService::$userRepo');
    });
  });

  describe('constant extraction', () => {
    it('extracts class constants', () => {
      const source = readFileSync(join(FIXTURES, 'app/Models/User.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const user = result.symbols[0];

      const constants = user.children.filter(c => c.kind === 'constant');
      expect(constants.length).toBeGreaterThanOrEqual(2);
      expect(constants.map(c => c.name)).toContain('STATUS_ACTIVE');
      expect(constants.map(c => c.name)).toContain('STATUS_INACTIVE');
    });
  });

  describe('namespace resolution', () => {
    it('tracks use statement imports', () => {
      const source = readFileSync(join(FIXTURES, 'app/Services/UserService.php'), 'utf-8');
      const result = parsePHP(source, parser);

      expect(result.imports.get('User')).toBe('App\\Models\\User');
      expect(result.imports.get('UserRepository')).toBe('App\\Repositories\\UserRepository');
    });

    it('resolves aliased imports', () => {
      const source = `<?php
namespace App\\Tests;

use App\\Models\\User as UserModel;

class UserTest {}
`;
      const result = parsePHP(source, parser);
      expect(result.imports.get('UserModel')).toBe('App\\Models\\User');
    });

    it('resolves type names in extends/implements via imports', () => {
      // User.php: `use Illuminate\Database\Eloquent\Model` then `extends Model`
      // The qualified name for extends should be the fully qualified import, not just "Model"
      const source = readFileSync(join(FIXTURES, 'app/Models/User.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const user = result.symbols[0];

      expect(user.metadata.extends).toBe('Illuminate\\Database\\Eloquent\\Model');
    });
  });

  describe('docblock extraction', () => {
    it('extracts docblock from class', () => {
      const source = readFileSync(join(FIXTURES, 'app/Models/User.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const user = result.symbols[0];

      expect(user.docblock).toContain('User model');
    });

    it('extracts docblock from method', () => {
      const source = readFileSync(join(FIXTURES, 'app/Services/UserService.php'), 'utf-8');
      const result = parsePHP(source, parser);
      const service = result.symbols[0];

      const findById = service.children.find(c => c.name === 'findById');
      expect(findById?.docblock).toContain('Find a user');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/indexer/parsers/php.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement PHP parser**

Create `src/indexer/parsers/php.ts`. This is the core extraction logic. The implementation should handle:

1. Walk top-level nodes for namespace, use statements, class/interface/trait/enum/function declarations
2. Track namespace context (current namespace + import map)
3. For each class-like declaration: extract name, compute qualified name, extract extends/implements (resolving via imports), walk body for methods/properties/constants
4. For methods: extract name, visibility, return type, signature, docblock, flag magic methods
5. For properties: extract name, visibility, type, flag static/readonly
6. For constants: extract name within const_element nodes
7. For docblocks: look for `comment` node immediately preceding the declaration (must start with `/**`)
8. Qualified name format: `Namespace\ClassName` for classes, `Namespace\ClassName::methodName` for methods, `Namespace\ClassName::$propName` for properties

Key type resolution function: when resolving a type name (e.g., `Model` in `extends Model`):
- If starts with `\`, strip leading `\` and use as-is (fully qualified)
- If the first segment matches an import alias, replace with the full import path
- Otherwise, prepend current namespace

> **Refer to the AST exploration output from Task 6** to get exact node type names. The implementation in this plan uses typical tree-sitter-php types but they may need adjustment.

Full implementation (~200 lines) — write based on the node types discovered in Task 6 Step 2. The test suite above defines the exact behavior contract.

- [ ] **Step 4: Run tests and iterate until all pass**

```bash
npx vitest run tests/indexer/parsers/php.test.ts
```

Expected: all tests pass. If any fail, adjust the parser based on actual tree-sitter node types.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/parsers/php.ts tests/indexer/parsers/php.test.ts
git commit -m "[feat]: PHP parser — class, method, property, constant extraction with namespace resolution"
```

---

## Chunk 4: Storage & Integration

### Task 8: Repository Classes

**Files:**
- Create: `src/db/repositories/repo-repository.ts`
- Create: `src/db/repositories/file-repository.ts`
- Create: `src/db/repositories/symbol-repository.ts`
- Test: `tests/db/repositories/symbol-repository.test.ts`

- [ ] **Step 1: Create test setup for DB tests**

```typescript
// tests/setup.ts
import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function setup() {
  // Create test database if it doesn't exist
  const adminPool = new pg.Pool({
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    user: 'cartograph',
    password: 'localdev',
  });

  try {
    await adminPool.query('CREATE DATABASE cartograph_test');
    console.log('Created cartograph_test database');
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    if (!pgErr.message?.includes('already exists')) throw err;
  }
  await adminPool.end();

  // Run migrations on test DB
  const testPool = new pg.Pool({
    host: 'localhost',
    port: 5432,
    database: 'cartograph_test',
    user: 'cartograph',
    password: 'localdev',
  });

  await runMigrations(testPool, join(__dirname, '..', 'src', 'db', 'migrations'));
  await testPool.end();
}
```

> **Note:** Update `runMigrations` to accept `migrationsDir` as a parameter instead of computing it relative to `import.meta.url`. This makes it testable and avoids path issues between src/ and dist/.

- [ ] **Step 2: Write failing symbol repository test**

```typescript
// tests/db/repositories/symbol-repository.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { RepoRepository } from '../../../src/db/repositories/repo-repository.js';
import { FileRepository } from '../../../src/db/repositories/file-repository.js';
import { SymbolRepository } from '../../../src/db/repositories/symbol-repository.js';
import type { ParsedSymbol } from '../../../src/types.js';

const TEST_POOL_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'cartograph_test',
  user: 'cartograph',
  password: 'localdev',
};

describe('SymbolRepository', () => {
  let pool: pg.Pool;
  let repoRepo: RepoRepository;
  let fileRepo: FileRepository;
  let symbolRepo: SymbolRepository;

  beforeAll(() => {
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
  });

  it('stores and retrieves symbols with parent-child relationships', async () => {
    const repo = await repoRepo.findOrCreate('/test/repo', 'test-repo');
    const file = await fileRepo.upsert(repo.id, 'app/Services/UserService.php', 'php', 'abc123', 50);

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

    await symbolRepo.replaceFileSymbols(file.id, [classSymbol]);

    const symbols = await symbolRepo.findByFile(file.id);
    expect(symbols).toHaveLength(2); // class + method

    const cls = symbols.find(s => s.kind === 'class');
    expect(cls?.qualifiedName).toBe('App\\Services\\UserService');
    expect(cls?.parentSymbolId).toBeNull();

    const method = symbols.find(s => s.kind === 'method');
    expect(method?.qualifiedName).toBe('App\\Services\\UserService::findById');
    expect(method?.parentSymbolId).toBe(cls?.id);
    expect(method?.visibility).toBe('public');
    expect(method?.returnType).toBe('?User');
  });

  it('replaceFileSymbols is idempotent', async () => {
    const repo = await repoRepo.findOrCreate('/test/repo', 'test-repo');
    const file = await fileRepo.upsert(repo.id, 'test.php', 'php', 'hash1', 10);

    const symbols: ParsedSymbol[] = [{
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
    }];

    await symbolRepo.replaceFileSymbols(file.id, symbols);
    await symbolRepo.replaceFileSymbols(file.id, symbols);

    const result = await symbolRepo.findByFile(file.id);
    expect(result).toHaveLength(1);
  });

  it('countByRepo returns total symbols across all files', async () => {
    const repo = await repoRepo.findOrCreate('/test/repo', 'test-repo');
    const f1 = await fileRepo.upsert(repo.id, 'a.php', 'php', 'h1', 10);
    const f2 = await fileRepo.upsert(repo.id, 'b.php', 'php', 'h2', 10);

    await symbolRepo.replaceFileSymbols(f1.id, [{
      name: 'A', qualifiedName: 'A', kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 5, signature: null, returnType: null,
      docblock: null, children: [], metadata: {},
    }]);
    await symbolRepo.replaceFileSymbols(f2.id, [{
      name: 'B', qualifiedName: 'B', kind: 'class', visibility: null,
      lineStart: 1, lineEnd: 5, signature: null, returnType: null,
      docblock: null, children: [], metadata: {},
    }]);

    const count = await symbolRepo.countByRepo(repo.id);
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/db/repositories/symbol-repository.test.ts
```

Expected: FAIL (modules not found).

- [ ] **Step 4: Implement all three repository classes**

Implement `repo-repository.ts`, `file-repository.ts`, `symbol-repository.ts` with:

- **RepoRepository:** `findOrCreate(path, name)` using INSERT ON CONFLICT, `updateLastIndexed(id)`
- **FileRepository:** `upsert(repoId, path, language, hash, linesOfCode)` using INSERT ON CONFLICT, `getFileHashes(repoId)` returning Map<path, hash>, `deleteByPaths(repoId, paths[])`
- **SymbolRepository:** `replaceFileSymbols(fileId, symbols[])` — DELETE existing + INSERT new in a transaction, recursively inserting children with parent IDs. `findByFile(fileId)`, `countByRepo(repoId)`

All repositories take `pg.Pool` in constructor (DI pattern).

- [ ] **Step 5: Run tests and verify they pass**

```bash
npx vitest run tests/db/repositories/symbol-repository.test.ts
```

Expected: all 3 tests pass. Requires Docker postgres running.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/ tests/db/ tests/setup.ts
git commit -m "[feat]: repository classes for repos, files, and symbols with DB integration tests"
```

---

### Task 9: Index Command + Pipeline

**Files:**
- Create: `src/indexer/pipeline.ts`
- Create: `src/cli/index.ts`
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Create indexing pipeline**

```typescript
// src/indexer/pipeline.ts
import type pg from 'pg';
import type { CartographConfig, DiscoveredFile } from '../types.js';
import { discoverFiles } from './file-walker.js';
import { AstParser } from './ast-parser.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { FileRepository } from '../db/repositories/file-repository.js';
import { SymbolRepository } from '../db/repositories/symbol-repository.js';
import { IndexError } from '../errors.js';
import { basename, resolve } from 'path';

export class IndexPipeline {
  private repoRepo: RepoRepository;
  private fileRepo: FileRepository;
  private symbolRepo: SymbolRepository;

  constructor(pool: pg.Pool) {
    this.repoRepo = new RepoRepository(pool);
    this.fileRepo = new FileRepository(pool);
    this.symbolRepo = new SymbolRepository(pool);
  }

  async run(repoPath: string, config: CartographConfig): Promise<void> {
    const absPath = resolve(repoPath);
    console.log(`Indexing ${absPath}...`);

    // 1. Register repo
    const repo = await this.repoRepo.findOrCreate(absPath, basename(absPath));

    // 2. Discover files
    const discovered = await discoverFiles(absPath, config);
    console.log(`Found ${discovered.length} source files`);

    if (discovered.length === 0) {
      console.log('No source files found. Check your language and exclude config.');
      return;
    }

    // 3. Compute changeset
    const storedHashes = await this.fileRepo.getFileHashes(repo.id);
    const changeset = this.computeChangeset(discovered, storedHashes);
    console.log(
      `Changes: ${changeset.added.length} new, ${changeset.modified.length} modified, ${changeset.deleted.length} deleted`
    );

    // 4. Remove deleted files (CASCADE deletes their symbols)
    if (changeset.deleted.length > 0) {
      await this.fileRepo.deleteByPaths(repo.id, changeset.deleted);
    }

    // 5. Parse and store new/modified files
    const parser = new AstParser();
    const toProcess = [...changeset.added, ...changeset.modified];
    let errors = 0;

    for (const file of toProcess) {
      try {
        const { symbols, linesOfCode } = parser.parse(file);
        const fileRecord = await this.fileRepo.upsert(
          repo.id,
          file.relativePath,
          file.language,
          file.hash,
          linesOfCode
        );
        await this.symbolRepo.replaceFileSymbols(fileRecord.id, symbols);
      } catch (err) {
        errors++;
        console.error(`  Error parsing ${file.relativePath}: ${err}`);
      }
    }

    // 6. Update repo timestamp
    await this.repoRepo.updateLastIndexed(repo.id);

    // 7. Report
    const totalSymbols = await this.symbolRepo.countByRepo(repo.id);
    console.log(
      `Done. Processed ${toProcess.length - errors} files (${errors} errors). ${totalSymbols} symbols indexed.`
    );

    if (errors > 0) {
      throw new IndexError(`${errors} file(s) failed to parse`);
    }
  }

  private computeChangeset(
    discovered: DiscoveredFile[],
    storedHashes: Map<string, string>
  ): { added: DiscoveredFile[]; modified: DiscoveredFile[]; deleted: string[] } {
    const added: DiscoveredFile[] = [];
    const modified: DiscoveredFile[] = [];
    const currentPaths = new Set<string>();

    for (const file of discovered) {
      currentPaths.add(file.relativePath);
      const stored = storedHashes.get(file.relativePath);

      if (!stored) {
        added.push(file);
      } else if (stored !== file.hash) {
        modified.push(file);
      }
    }

    const deleted = [...storedHashes.keys()].filter(p => !currentPaths.has(p));
    return { added, modified, deleted };
  }
}
```

- [ ] **Step 2: Create CLI index command**

```typescript
// src/cli/index.ts
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { createPool } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { IndexPipeline } from '../indexer/pipeline.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createIndexCommand(): Command {
  return new Command('index')
    .description('Build or update the codebase index')
    .argument('<repo-path>', 'Path to the repository to index')
    .option('--run-migrations', 'Run database migrations before indexing')
    .action(async (repoPath: string, opts: { runMigrations?: boolean }) => {
      const config = loadConfig(repoPath);
      const pool = createPool(config.database);

      try {
        if (opts.runMigrations) {
          console.log('Running migrations...');
          await runMigrations(pool, join(__dirname, '..', 'db', 'migrations'));
        }

        const pipeline = new IndexPipeline(pool);
        await pipeline.run(repoPath, config);
      } finally {
        await pool.end();
      }
    });
}
```

- [ ] **Step 3: Create CLI entry point**

```typescript
// src/cli/main.ts
import { Command } from 'commander';
import { createIndexCommand } from './index.js';

const program = new Command();

program
  .name('cartograph')
  .description('Map your codebase so AI can navigate it')
  .version('0.1.0');

program.addCommand(createIndexCommand());

program.parse();
```

- [ ] **Step 4: Verify CLI runs**

```bash
npx tsx src/cli/main.ts --help
npx tsx src/cli/main.ts index --help
```

Expected: help text for cartograph and the index subcommand.

- [ ] **Step 5: Manual smoke test on fixture project**

```bash
npx tsx src/cli/main.ts index --run-migrations tests/fixtures/laravel-sample
```

Expected output similar to:
```
Running migrations...
Indexing /Users/mido/Desktop/personal/cargographer/tests/fixtures/laravel-sample...
Found 4 source files
Changes: 4 new, 0 modified, 0 deleted
Done. Processed 4 files (0 errors). N symbols indexed.
```

- [ ] **Step 6: Commit**

```bash
git add src/indexer/pipeline.ts src/cli/index.ts src/cli/main.ts
git commit -m "[feat]: index command — end-to-end pipeline wiring (discover, parse, store)"
```

---

### Task 10: Integration Test

**Files:**
- Create: `tests/integration/index-command.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/integration/index-command.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { IndexPipeline } from '../../src/indexer/pipeline.js';
import { join } from 'path';
import type { CartographConfig } from '../../src/types.js';

const TEST_DB = {
  host: 'localhost',
  port: 5432,
  database: 'cartograph_test',
  user: 'cartograph',
  password: 'localdev',
};

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'laravel-sample');

function testConfig(): CartographConfig {
  return {
    languages: ['php'],
    exclude: ['vendor/'],
    database: { host: TEST_DB.host, port: TEST_DB.port, name: TEST_DB.database, user: TEST_DB.user, password: TEST_DB.password },
  };
}

describe('Index Pipeline (Integration)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ ...TEST_DB, database: TEST_DB.database });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean slate
    await pool.query('DELETE FROM symbol_references');
    await pool.query('DELETE FROM symbols');
    await pool.query('DELETE FROM files');
    await pool.query('DELETE FROM repos');
  });

  it('indexes fixture project and stores correct symbols', async () => {
    const pipeline = new IndexPipeline(pool);
    await pipeline.run(FIXTURES, testConfig());

    // Verify files
    const { rows: files } = await pool.query('SELECT * FROM files ORDER BY path');
    expect(files).toHaveLength(4);
    expect(files.map((f: { path: string }) => f.path)).toEqual([
      'app/Http/Controllers/UserController.php',
      'app/Models/User.php',
      'app/Repositories/UserRepository.php',
      'app/Services/UserService.php',
    ]);

    // Verify key symbols exist with correct qualified names
    const { rows: userClass } = await pool.query(
      "SELECT * FROM symbols WHERE qualified_name = $1",
      ['App\\Models\\User']
    );
    expect(userClass).toHaveLength(1);
    expect(userClass[0].kind).toBe('class');

    const { rows: findById } = await pool.query(
      "SELECT * FROM symbols WHERE qualified_name = $1",
      ['App\\Services\\UserService::findById']
    );
    expect(findById).toHaveLength(1);
    expect(findById[0].kind).toBe('method');
    expect(findById[0].visibility).toBe('public');

    // Verify parent-child: findById's parent should be UserService
    const { rows: serviceClass } = await pool.query(
      "SELECT * FROM symbols WHERE qualified_name = $1",
      ['App\\Services\\UserService']
    );
    expect(findById[0].parent_symbol_id).toBe(serviceClass[0].id);
  });

  it('is idempotent — re-indexing produces same symbol count', async () => {
    const pipeline = new IndexPipeline(pool);
    const config = testConfig();

    await pipeline.run(FIXTURES, config);
    const { rows: first } = await pool.query('SELECT COUNT(*) FROM symbols');

    await pipeline.run(FIXTURES, config);
    const { rows: second } = await pool.query('SELECT COUNT(*) FROM symbols');

    expect(first[0].count).toBe(second[0].count);
  });

  it('second run detects 0 changes for unchanged files', async () => {
    const pipeline = new IndexPipeline(pool);
    const config = testConfig();

    await pipeline.run(FIXTURES, config);

    // On second run, all files have matching hashes → 0 new, 0 modified
    // The pipeline should complete without errors
    await pipeline.run(FIXTURES, config);

    const { rows } = await pool.query('SELECT COUNT(*) FROM symbols');
    expect(parseInt(rows[0].count)).toBeGreaterThan(0);
  });

  it('stores all expected symbol kinds', async () => {
    const pipeline = new IndexPipeline(pool);
    await pipeline.run(FIXTURES, testConfig());

    const { rows: kinds } = await pool.query(
      'SELECT DISTINCT kind FROM symbols ORDER BY kind'
    );
    const kindList = kinds.map((r: { kind: string }) => r.kind);

    expect(kindList).toContain('class');
    expect(kindList).toContain('method');
    expect(kindList).toContain('property');
    expect(kindList).toContain('constant');
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
npx vitest run tests/integration/index-command.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass (file-walker, php-parser, symbol-repository, integration).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/index-command.test.ts
git commit -m "[test]: integration test — full index pipeline on fixture Laravel project"
```

---

## Validation Checklist

After all tasks are complete, verify:

- [ ] `docker compose up -d` starts postgres and redis
- [ ] `npm run migrate` creates all tables
- [ ] `npx tsx src/cli/main.ts index tests/fixtures/laravel-sample` completes with 0 errors
- [ ] `npm test` — all unit + integration tests pass
- [ ] Re-running index on same project detects 0 changes (idempotency)
- [ ] Symbols in DB have correct qualified names (spot check via psql or test assertions)
- [ ] Methods have correct parent_symbol_id pointing to their class
- [ ] `npx tsx src/cli/main.ts --help` shows available commands

## What's Not Included (deferred to later milestones)

- Reference extraction (calls, inheritance, instantiation) → Milestone 2
- `code_embeddings` table → Milestone 6
- `project_profiles` table → Milestone 4
- Output generation (CLAUDE.md files) → Milestone 3
- MCP server → Milestone 5
- BullMQ job queue → Milestone 7
- Watch mode → Milestone 7

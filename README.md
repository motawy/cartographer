# Cartograph

**Map your codebase so AI can navigate it.**

Cartograph is a CLI tool that compiles deep structural intelligence about your codebase and outputs it in formats that AI coding tools can consume — auto-generated CLAUDE.md files, context documents, and a local MCP server. Instead of your AI assistant burning tokens grepping through thousands of files every session, it starts already knowing your architecture, dependencies, patterns, and conventions.

## The Problem

Every time you open Claude Code, Cursor, or Copilot on a large codebase, the AI spends most of its context window just *figuring out where things are*. It reads files, searches for patterns, builds a mental model — then throws it all away when the session ends. Next session, it starts from zero.

For a 1000+ file PHP monolith, this means:
- **Wasted tokens**: 20-50K tokens per session just on orientation
- **Shallow understanding**: The AI sees files it reads, but not the system
- **No dependency awareness**: It doesn't know that changing `UserService::findById()` breaks 14 controllers
- **No convention awareness**: It doesn't know your team always uses repository classes for DB access
- **Repetitive context-setting**: You explain the same architecture every new session

## The Solution

Cartograph pre-computes everything the AI needs to know and makes it available in two ways:

**Static context files** — A tree of CLAUDE.md files and structured documentation that AI tools read on session start. Zero tokens wasted on discovery. The AI begins every conversation with architectural awareness.

**MCP server** — A local server that AI tools can query on-demand: "What calls this method?" "What's the blast radius of this file?" "Trace the payment flow end-to-end." Answers come from the pre-built index in milliseconds, not from live file scanning.

```
┌──────────────────────────────┐
│   Your codebase (PHP, TS, …) │
└──────────────┬───────────────┘
               │
        cartograph index
               │
    ┌──────────▼──────────┐
    │   Codebase Index     │
    │  AST · Deps · Patterns│
    │     (PostgreSQL)      │
    └──────┬─────────┬─────┘
           │         │
   cartograph     cartograph
    generate        serve
           │         │
    ┌──────▼───┐ ┌───▼──────────┐
    │ .claude/  │ │  MCP Server  │
    │ CLAUDE.md │ │  (localhost)  │
    │ flow docs │ │              │
    │ dep maps  │ │  AI queries  │
    └──────────┘ │  on demand   │
         │       └──────────────┘
         │              │
    ┌────▼──────────────▼────┐
    │  Claude Code / Cursor / │
    │  Copilot / any AI tool  │
    │                         │
    │  Starts with full       │
    │  codebase understanding │
    └─────────────────────────┘
```

---

## Quick Start

```bash
# Install
npm install -g cartograph

# Start local infrastructure
docker compose up -d  # Postgres + Redis

# Index your codebase
cartograph index /path/to/your/project

# Generate AI context files
cartograph generate /path/to/your/project

# Start MCP server (for dynamic queries)
cartograph serve
```

After generation, your project will contain:
```
your-project/
├── CLAUDE.md                          # Auto-generated root context (references .cartograph/)
├── .cartograph/
│   ├── architecture.md                # System-level architecture overview
│   ├── conventions.md                 # Detected coding patterns and conventions
│   ├── deps/
│   │   ├── service-dependencies.md    # Service-to-service dependency map
│   │   └── database-access.md        # Which code touches which tables
│   ├── flows/
│   │   ├── payment-flow.md           # End-to-end payment execution path
│   │   ├── auth-flow.md              # Authentication/authorization flow
│   │   └── ...                        # Auto-detected domain flows
│   └── modules/
│       ├── services.md                # Service layer overview + key methods
│       ├── controllers.md             # Controller layer + route mapping
│       ├── models.md                  # Data model relationships
│       └── ...
├── app/
│   ├── Services/
│   │   ├── CLAUDE.md                  # Auto-generated: this directory's context
│   │   ├── UserService.php
│   │   └── ...
│   ├── Http/Controllers/
│   │   ├── CLAUDE.md                  # Auto-generated: controller layer context
│   │   └── ...
```

---

## How It Works

Cartograph has four analysis modules that build the index, and two output modes that make it consumable.

### Analysis Modules

#### Module 1: AST Structural Index
Parses every source file using Tree-sitter and extracts a complete inventory of symbols — classes, methods, functions, properties, interfaces, traits, constants. Stores fully qualified names, signatures, return types, visibility, line ranges, and docblocks.

This is the foundation. It answers: "What exists in this codebase and where?"

#### Module 2: Dependency Graph
Maps how symbols relate: what calls what, what extends what, what implements what, what instantiates what. Built from reference extraction during AST parsing, then cross-file resolution to link callers to callees.

This powers blast-radius analysis. It answers: "If I change this, what else could break?"

#### Module 3: Semantic Embeddings (Optional)
Embeds each function/method/class as a vector using a code-specific embedding model. Enables similarity search: "Find code that does something similar to this."

This catches duplication and inconsistency. It answers: "Does similar code already exist?"

#### Module 4: Pattern Extraction
Analyzes the codebase to discover implicit conventions — error handling patterns, architectural layering, naming conventions, dependency injection style, test coverage patterns. Combines deterministic AST analysis with optional LLM-assisted summarization.

This captures tribal knowledge. It answers: "How does this team write code?"

### Output Modes

#### Static Files (`cartograph generate`)

Generates a hierarchy of AI-readable context files:

**Root CLAUDE.md**: High-level project summary — tech stack, architecture overview, key conventions, directory guide. References `.cartograph/` for details. Designed to stay within ~2-3K tokens so it's cheap to load on every session.

**Subdirectory CLAUDE.md files**: Each major directory (e.g., `app/Services/`, `app/Http/Controllers/`) gets its own context file describing: what this layer does, key classes and their responsibilities, important patterns to follow, common gotchas, and cross-references to related layers.

**Domain flow documents**: End-to-end execution paths traced through the dependency graph. Example: `.cartograph/flows/payment-flow.md` traces from `CheckoutController::store()` through `OrderService::create()` → `PaymentService::charge()` → `StripeGateway::process()` → `TransactionRepository::record()`, showing every hop with file paths and method signatures.

**Dependency maps**: Structured documentation of service-to-service dependencies, database access patterns (which services touch which tables), and external API integrations.

**Convention guide**: The extracted patterns formatted as rules with examples — "This project uses the repository pattern for all database access. 91% of services follow this pattern. Example: `UserRepository::findById()` in `app/Repositories/UserRepository.php`."

All generated files include a `<!-- Generated by Cartograph -->` header and are designed to be committed to version control so every team member's AI sessions benefit.

#### MCP Server (`cartograph serve`)

A local Model Context Protocol server that AI tools can connect to for dynamic queries. The server reads from the pre-built index — it never scans files live.

**Available MCP tools:**

```
cartograph_deps          — "What depends on UserService::findById?"
                           Returns: list of callers with file paths and line numbers

cartograph_blast_radius  — "What's the blast radius of changing src/Services/UserService.php?"
                           Returns: all symbols in the file + their transitive dependents,
                           grouped by layer (controllers, services, jobs, tests)

cartograph_flow          — "Trace the execution flow from CheckoutController::store"
                           Returns: ordered list of method calls with file paths,
                           showing the full path from entry point to data layer

cartograph_similar       — "Find code similar to this snippet: [code]"
                           Returns: top N most similar existing functions with
                           similarity scores and file paths

cartograph_conventions   — "What are the conventions for error handling in this project?"
                           Returns: detected patterns with confidence scores and examples

cartograph_symbol        — "Tell me about App\\Services\\PaymentService"
                           Returns: class overview, methods, dependencies, dependents,
                           related tests, and which conventions it follows/violates

cartograph_module        — "Summarize the app/Services directory"
                           Returns: all classes, their responsibilities, internal
                           dependencies, and key patterns
```

**Connecting to Claude Code:**
```json
// In your Claude Code MCP config
{
  "mcpServers": {
    "cartograph": {
      "command": "cartograph",
      "args": ["serve", "--stdio"]
    }
  }
}
```

**Connecting to Cursor:**
```json
// In .cursor/mcp.json
{
  "mcpServers": {
    "cartograph": {
      "command": "cartograph",
      "args": ["serve", "--stdio"]
    }
  }
}
```

---

## Configuration

```yaml
# .cartograph.yml — placed in the repo root
languages:
  - php
  - typescript

exclude:
  - vendor/
  - node_modules/
  - storage/
  - tests/fixtures/
  - database/migrations/

embedding:
  enabled: true              # set false to skip Module 3 (no API costs)
  provider: voyage           # or openai
  model: voyage-code-3
  batch_size: 100

llm:
  enabled: true              # set false to skip LLM convention summarization
  provider: anthropic
  model: claude-sonnet-4-20250514
  # API key from ANTHROPIC_API_KEY env var

profile:
  confidence_threshold: 0.70
  exclude_dirs:
    - database/migrations/

output:
  root_claude_md: true                  # generate root CLAUDE.md
  subdirectory_claude_md: true          # generate per-directory CLAUDE.md files
  flow_docs: true                       # generate .cartograph/flows/
  dep_maps: true                        # generate .cartograph/deps/
  convention_guide: true                # generate .cartograph/conventions.md
  max_root_tokens: 3000                 # keep root CLAUDE.md under this size

mcp:
  port: 3100                            # MCP server port (if using HTTP, not stdio)

database:
  host: localhost
  port: 5432
  name: cartograph
  # Or use DATABASE_URL env var
```

---

## Local Development Setup

```yaml
# docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: cartograph
      POSTGRES_USER: cartograph
      POSTGRES_PASSWORD: localdev
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  pgdata:
```

---

## Architecture Deep Dive

### Database Schema

```sql
-- Core tables
CREATE TABLE files (
    id              SERIAL PRIMARY KEY,
    repo_id         INTEGER NOT NULL,
    path            TEXT NOT NULL,
    language        VARCHAR(32) NOT NULL,
    hash            VARCHAR(64) NOT NULL,     -- SHA-256 for change detection
    last_indexed_at TIMESTAMPTZ NOT NULL,
    lines_of_code   INTEGER,
    UNIQUE(repo_id, path)
);

CREATE TABLE symbols (
    id               SERIAL PRIMARY KEY,
    file_id          INTEGER REFERENCES files(id) ON DELETE CASCADE,
    kind             VARCHAR(32) NOT NULL,     -- function, method, class, interface, trait, property, constant
    name             TEXT NOT NULL,
    qualified_name   TEXT,                     -- App\Services\UserService::findById
    visibility       VARCHAR(16),
    parent_symbol_id INTEGER REFERENCES symbols(id),
    line_start       INTEGER NOT NULL,
    line_end         INTEGER NOT NULL,
    signature        TEXT,
    return_type      TEXT,
    docblock         TEXT,
    metadata         JSONB
);

CREATE TABLE symbol_references (
    id                    SERIAL PRIMARY KEY,
    source_symbol_id      INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
    target_qualified_name TEXT NOT NULL,
    target_symbol_id      INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
    reference_kind        VARCHAR(32),         -- call, instantiation, inheritance, import, type_hint
    line_number           INTEGER
);

-- Optional: embeddings for similarity search
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE code_embeddings (
    id          SERIAL PRIMARY KEY,
    symbol_id   INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
    file_id     INTEGER REFERENCES files(id) ON DELETE CASCADE,
    chunk_type  VARCHAR(32) NOT NULL,
    chunk_text  TEXT NOT NULL,
    embedding   vector(1024) NOT NULL,
    UNIQUE(symbol_id, chunk_type)
);

CREATE INDEX idx_embeddings_hnsw ON code_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Pattern extraction results
CREATE TABLE project_profiles (
    id           SERIAL PRIMARY KEY,
    repo_id      INTEGER NOT NULL,
    profile      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    file_count   INTEGER,
    symbol_count INTEGER
);
```

### Indexing Pipeline

```
cartograph index /path/to/repo

1. File discovery
   - Walk repo tree respecting .gitignore + .cartograph.yml excludes
   - Compute SHA-256 hash for each source file
   - Compare with stored hashes → build changeset (new/modified/deleted)

2. AST parsing (Module 1)
   - For each new/modified file: parse with Tree-sitter
   - Extract symbols: classes, methods, functions, properties, constants
   - Extract references: calls, instantiation, inheritance, type hints, imports
   - Upsert into symbols + symbol_references tables
   - Deleted files: CASCADE removes symbols + references

3. Reference resolution (Module 2)
   - For all unresolved references (target_symbol_id IS NULL):
     match target_qualified_name → symbols.qualified_name
   - Mark unresolvable references as "external" (vendor/library)

4. Embedding generation (Module 3, if enabled)
   - For each new/modified symbol: build chunk text (code + structural context)
   - Batch embed via API (100 per request)
   - Upsert into code_embeddings

5. Pattern extraction (Module 4)
   - Run deterministic pattern detectors (error handling, architecture, naming, tests)
   - Compute frequency statistics
   - If LLM enabled: summarize conventions via Claude API
   - Store as project_profiles entry
```

### Output Generation Pipeline

```
cartograph generate /path/to/repo

1. Load index from database
2. Generate root CLAUDE.md
   - Project summary (language, framework, size)
   - High-level architecture (layers, key directories)
   - Top 5 conventions (from profile)
   - Directory guide with cross-references
   - Token budget: keep under max_root_tokens config

3. Generate subdirectory CLAUDE.md files
   - For each directory with 3+ source files:
     - List key classes/functions with one-line descriptions
     - Note the layer role (controller, service, repository, model, etc.)
     - List top dependencies (what this layer calls)
     - List top dependents (what calls this layer)
     - Note any convention deviations

4. Generate .cartograph/ docs
   a. architecture.md — full system architecture with layers diagram
   b. conventions.md — all detected patterns with examples
   c. flows/ — trace entry points through dep graph, format as step-by-step
   d. deps/ — service dependency map, database access patterns
   e. modules/ — per-layer summaries

5. Write all files to disk
```

### MCP Server Architecture

```
cartograph serve

- Starts a local MCP server (stdio mode for Claude Code, HTTP for others)
- Each MCP tool maps to a database query:

  cartograph_deps         → recursive CTE on symbol_references
  cartograph_blast_radius → reverse dep walk from all symbols in a file
  cartograph_flow         → forward dep walk from an entry symbol
  cartograph_similar      → pgvector nearest-neighbor query
  cartograph_conventions  → read from project_profiles
  cartograph_symbol       → join symbols + references + embeddings
  cartograph_module       → aggregate symbols by directory

- All responses formatted as structured markdown
  (AI tools consume markdown better than JSON for reasoning)
- Server is read-only: never writes to the codebase or index
- Server caches hot queries in Redis (TTL: until next index run)
```

---

## Build Plan & Milestones

### Milestone 1: "I can parse a PHP project" (Week 1-2)
- [ ] Project scaffold: TypeScript, Commander.js CLI, Docker Compose
- [ ] Database migrations for `files`, `symbols`, `symbol_references`
- [ ] File walker with .gitignore support
- [ ] PHP Tree-sitter parser: classes, methods, functions, properties
- [ ] Namespace resolution for PHP `use` statements
- [ ] Symbol extraction + database storage
- [ ] `cartograph index` command works end-to-end
- [ ] Test on a real Laravel project

**Ship gate**: Run `cartograph index` on your work codebase. Verify symbol count looks right.

### Milestone 2: "I can trace dependencies" (Week 3)
- [ ] Reference extraction: calls, inheritance, instantiation, type hints
- [ ] Cross-file reference resolution
- [ ] Blast-radius query (recursive CTE)
- [ ] Forward flow tracing (follow calls from entry point)
- [ ] `cartograph query deps` and `cartograph query blast-radius` work
- [ ] Test: change a model method → see all affected controllers

**Ship gate**: Run blast-radius on a method you know well. Does it match your mental model?

### Milestone 3: "I can generate useful context files" (Week 4-5)
- [ ] Root CLAUDE.md generator (architecture summary, conventions, directory guide)
- [ ] Subdirectory CLAUDE.md generator
- [ ] Flow document generator (trace entry points through dep graph)
- [ ] Dependency map generator
- [ ] `cartograph generate` command works end-to-end
- [ ] Token budgeting (keep root CLAUDE.md under configured limit)

**Ship gate**: Generate context for your work codebase. Open Claude Code in the repo. Does it immediately know things it used to spend 5 minutes discovering?

### Milestone 4: "I can extract patterns" (Week 5-6)
- [ ] Deterministic pattern detectors:
  - Error handling style (try/catch, Result types, error codes)
  - Architectural layering (controller→service→repository flow)
  - Naming conventions (class suffixes, method prefixes)
  - Test coverage mapping (source files ↔ test files)
  - DI patterns (constructor injection, facades, service locator)
- [ ] Statistical frequency analysis
- [ ] LLM-assisted convention summarization (optional)
- [ ] Convention guide output (`.cartograph/conventions.md`)
- [ ] Integrate into `cartograph generate`

**Ship gate**: Read the generated conventions.md. Does it describe how your team *actually* writes code?

### Milestone 5: "AI tools can query me on demand" (Week 7-8)
- [ ] MCP server skeleton (stdio transport for Claude Code)
- [ ] Implement `cartograph_deps` tool
- [ ] Implement `cartograph_blast_radius` tool
- [ ] Implement `cartograph_flow` tool
- [ ] Implement `cartograph_symbol` tool
- [ ] Implement `cartograph_module` tool
- [ ] Connect to Claude Code via MCP config
- [ ] Test: ask Claude Code "what's the blast radius of UserService?" and get instant answer

**Ship gate**: Use Claude Code with Cartograph MCP for a real task. Is it noticeably faster/smarter?

### Milestone 6: "Similarity search works" (Week 9-10)
- [ ] Embedding pipeline with Voyage AI
- [ ] pgvector storage + HNSW index
- [ ] `cartograph_similar` MCP tool
- [ ] `cartograph query similar` CLI command
- [ ] Duplication detection in generated docs

**Ship gate**: Find a real duplicate in your work codebase that you didn't know about.

### Milestone 7: Incremental + Polish (Week 10-12)
- [ ] Incremental indexing (hash-based, only re-process changed files)
- [ ] Incremental output regeneration
- [ ] Redis caching for MCP server hot queries
- [ ] BullMQ job queue for background indexing
- [ ] Watch mode (`cartograph watch` — re-index on file save)
- [ ] Performance tuning (target: <30s full index on 1000 files)
- [ ] Error recovery and edge case handling

---

## Example Outputs

### Generated Root CLAUDE.md (example)

```markdown
<!-- Generated by Cartograph. Do not edit manually. Run: cartograph generate -->
# Project: MyApp

PHP 8.2 / Laravel 10 monolith. 847 source files, 3,241 classes/functions.

## Architecture
Three-layer architecture: HTTP Controllers → Service Layer → Repository Layer → Eloquent Models.
All database access goes through repositories. Controllers never touch models directly.

## Key Conventions
- Error handling: Services use try/catch with Log::error() before rethrowing (87% adherence)
- DI: Constructor injection everywhere. No facades in service layer. (93% adherence)
- Naming: Services suffixed *Service, Repositories suffixed *Repository
- Testing: PHPUnit, 64% of services have corresponding test files

## Directory Guide
- `app/Http/Controllers/` — HTTP layer. See [controllers context](.cartograph/modules/controllers.md)
- `app/Services/` — Business logic. See [services context](.cartograph/modules/services.md)
- `app/Repositories/` — Data access. See [repository context](.cartograph/modules/repositories.md)
- `app/Models/` — Eloquent models. See [models context](.cartograph/modules/models.md)
- `app/Jobs/` — Queued jobs. See [jobs context](.cartograph/modules/jobs.md)

## Key Flows
- [Payment flow](.cartograph/flows/payment-flow.md): Checkout → OrderService → PaymentService → Stripe
- [Auth flow](.cartograph/flows/auth-flow.md): Login → AuthController → AuthService → JWT
- [Order lifecycle](.cartograph/flows/order-lifecycle.md): Create → Process → Fulfill → Complete

## Dependencies
- [Service dependency map](.cartograph/deps/service-dependencies.md)
- [Database access map](.cartograph/deps/database-access.md)
```

### Generated Flow Document (example)

```markdown
<!-- Generated by Cartograph -->
# Flow: Payment Processing

Entry point: `App\Http\Controllers\CheckoutController::store()`
Triggered by: POST /checkout

## Execution Path

1. **CheckoutController::store()** → `app/Http/Controllers/CheckoutController.php:45`
   - Validates request via FormRequest
   - Calls OrderService::create()

2. **OrderService::create()** → `app/Services/OrderService.php:67`
   - Creates Order model via OrderRepository
   - Dispatches OrderCreated event
   - Calls PaymentService::charge()

3. **PaymentService::charge()** → `app/Services/PaymentService.php:34`
   - Resolves payment gateway from config
   - Calls StripeGateway::process()
   - Wraps in try/catch, logs failures

4. **StripeGateway::process()** → `app/Gateways/StripeGateway.php:22`
   - Calls Stripe API via stripe-php SDK
   - Returns PaymentResult value object

5. **TransactionRepository::record()** → `app/Repositories/TransactionRepository.php:18`
   - Persists transaction to `transactions` table
   - Called by PaymentService on success/failure

## Blast Radius
Changing PaymentService::charge() affects:
- CheckoutController::store() (direct caller)
- OrderService::create() (direct caller)
- RetryPaymentJob::handle() (queued retry)
- PaymentServiceTest (test coverage exists)

## Database Tables Touched
- orders (write: OrderRepository::create)
- transactions (write: TransactionRepository::record)
- payment_methods (read: PaymentService::resolveGateway)
```

### MCP Query Response (example)

```
User (via Claude Code): "What's the blast radius of UserService?"

Claude Code calls: cartograph_blast_radius({ file: "app/Services/UserService.php" })

Response:
# Blast Radius: app/Services/UserService.php

## Symbols in this file (8 methods)
- UserService::findById, ::findByEmail, ::create, ::update,
  ::delete, ::activate, ::deactivate, ::resetPassword

## Direct dependents (14 files)
### Controllers (5)
- UserController::show → calls findById
- UserController::update → calls update
- AuthController::login → calls findByEmail
- AdminController::users → calls findById
- ProfileController::edit → calls findById, update

### Jobs (3)
- SendWelcomeEmailJob → calls findById
- DeactivateInactiveUsersJob → calls deactivate
- PasswordResetJob → calls resetPassword

### Other Services (4)
- OrderService::create → calls findById (resolves buyer)
- NotificationService::send → calls findById (resolves recipient)
- TeamService::addMember → calls findById, activate
- ReportService::userActivity → calls findById

### Tests (2)
- UserServiceTest — covers: findById, create, update, delete
- AuthServiceTest — covers: findByEmail (indirectly)

## Uncovered methods (no dependents found)
- UserService::activate — only called from TeamService (1 caller)
- UserService::deactivate — only called from DeactivateInactiveUsersJob (1 caller)
```

---

## Project Structure

```
cartograph/
├── CLAUDE.md
├── README.md
├── package.json
├── tsconfig.json
├── docker-compose.yml
├── src/
│   ├── cli/
│   │   ├── index.ts              # cartograph index
│   │   ├── generate.ts           # cartograph generate
│   │   ├── serve.ts              # cartograph serve
│   │   └── query.ts              # cartograph query (deps, blast-radius, etc.)
│   ├── indexer/
│   │   ├── file-walker.ts        # Git-aware file discovery
│   │   ├── ast-parser.ts         # Tree-sitter orchestrator
│   │   ├── parsers/
│   │   │   ├── php.ts            # PHP-specific extraction
│   │   │   ├── typescript.ts
│   │   │   └── python.ts
│   │   ├── symbol-extractor.ts   # AST → Symbol records
│   │   ├── dep-graph.ts          # Dependency graph builder + queries
│   │   ├── embedder.ts           # Embedding pipeline
│   │   └── profiler.ts           # Pattern extraction
│   ├── output/
│   │   ├── root-claude-md.ts     # Root CLAUDE.md generator
│   │   ├── subdir-claude-md.ts   # Per-directory CLAUDE.md generator
│   │   ├── flow-docs.ts          # Flow document generator
│   │   ├── dep-maps.ts           # Dependency map generator
│   │   ├── convention-guide.ts   # Convention guide generator
│   │   └── token-budget.ts       # Token counting + trimming
│   ├── mcp/
│   │   ├── server.ts             # MCP server setup
│   │   ├── tools/
│   │   │   ├── deps.ts           # cartograph_deps tool
│   │   │   ├── blast-radius.ts   # cartograph_blast_radius tool
│   │   │   ├── flow.ts           # cartograph_flow tool
│   │   │   ├── similar.ts        # cartograph_similar tool
│   │   │   ├── conventions.ts    # cartograph_conventions tool
│   │   │   ├── symbol.ts         # cartograph_symbol tool
│   │   │   └── module.ts         # cartograph_module tool
│   │   └── formatters.ts         # Response → markdown formatting
│   ├── db/
│   │   ├── migrations/
│   │   ├── connection.ts
│   │   └── repositories/
│   └── utils/
│       ├── git.ts
│       ├── llm.ts
│       └── tokens.ts             # Token estimation for output budgeting
├── tests/
│   ├── fixtures/
│   │   └── laravel-sample/       # Mini Laravel project
│   ├── indexer/
│   ├── output/
│   │   └── snapshots/            # Expected output snapshots
│   ├── mcp/
│   └── integration/
└── scripts/
    ├── seed-test-db.ts
    └── benchmark.ts
```

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-03-15 | Output-first design: files + MCP | Meets AI tools where they are today |
| 2025-03-15 | PHP parser first | Primary test codebase is PHP/Laravel |
| 2025-03-15 | pgvector over standalone vector DB | One fewer service, good enough at our scale |
| 2025-03-15 | CLI-first, no web UI | Outputs are consumed by AI tools, not humans |
| 2025-03-15 | RAG over fine-tuning | Cheaper, updatable, no retraining needed |
| 2025-03-15 | Token budgeting for generated files | Context window is precious, don't waste it |
| 2025-03-15 | MCP responses as markdown, not JSON | AI tools reason better over markdown |
| 2025-03-15 | Embeddings optional (Module 3) | Core value works without API costs |
| 2025-03-15 | LLM summarization optional (Module 4) | Deterministic patterns work standalone |
| | | |

---

## Philosophy

Cartograph is not an AI coding tool. It's infrastructure that makes every AI coding tool better.

The insight is that AI assistants are terrible at *discovering* codebase structure but excellent at *reasoning* about it once they have it. Cartograph front-loads the discovery so the AI can focus on reasoning.

Your codebase already contains all the knowledge an AI needs to help you effectively. Cartograph just compiles it into a format the AI can actually use.

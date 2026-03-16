# Milestone 2: Dependency Tracing

## Goal

Extract cross-file references from PHP AST, resolve them against the symbol index, and expose dependency/impact queries via CLI commands. Split into 2.1 (static references) and 2.2 (dynamic references — service locator, DI container).

## Architecture

Reference extraction is a **separate pass** from declaration parsing (Approach B). The current parser extracts "what exists" — the new `ReferenceExtractor` extracts "what references what" from the same AST tree. Cross-file resolution is a batch SQL operation after all files are processed.

Pipeline becomes:
```
Parse declarations → Extract references → Store references → Resolve cross-file (SQL) → Queries
```

## Milestone 2.1: Static References

### Reference Types Extracted

| Kind | AST Pattern | Example | Resolution |
|------|------------|---------|------------|
| `inheritance` | `extends Foo` | `class User extends Model` | Resolve `Foo` via imports/namespace |
| `implementation` | `implements Foo` | `class UserService implements UserServiceInterface` | Same |
| `trait_use` | `use Foo` in class body | `use HasTimestamps` | Same |
| `instantiation` | `new Foo()` | `new UserRepository()` | Resolve class name |
| `static_call` | `Foo::method()` | `UserService::create()` | Resolve `Foo`, append `::method` |
| `type_hint` | param/return/property types | `function find(User $u): ?User` | Resolve type name |
| `self_call` | `$this->method()` | `$this->findById()` | Resolve against containing class |
| `static_access` | `Foo::CONST` or `Foo::$prop` | `UserService::MAX_RETRIES` | Resolve `Foo`, append `::CONST` |

### Data Model

Uses the existing `symbol_references` table (migration 004):

```sql
symbol_references (
    id                    SERIAL PRIMARY KEY,
    source_symbol_id      INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    target_qualified_name TEXT NOT NULL,      -- e.g. "App\Services\UserService::findById"
    target_symbol_id      INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
    reference_kind        VARCHAR(32),        -- inheritance, instantiation, static_call, etc.
    line_number           INTEGER
)
```

- `source_symbol_id` — the symbol (method/function) that contains the reference
- `target_qualified_name` — fully qualified name of what's being referenced (resolved via imports/namespace)
- `target_symbol_id` — NULL initially, filled by cross-file resolution step
- `reference_kind` — one of the kinds from the table above
- `line_number` — line where the reference occurs

### New Components

#### `src/indexer/reference-extractor.ts`

```
ReferenceExtractor
├── extract(tree, namespaceContext, symbols): ParsedReference[]
│   Walk AST, collect references, resolve names using NamespaceContext
│
├── extractFromMethodBody(node, containingClass, context): ParsedReference[]
│   Handle: $this->method(), new Foo(), Foo::method(), Foo::CONST
│
├── extractFromClassDeclaration(node, context): ParsedReference[]
│   Handle: extends, implements, trait use
│
└── extractTypeHintReferences(node, context): ParsedReference[]
    Handle: parameter types, return types, property types
```

Input: the parsed tree + namespace context (already returned by `parsePHP` via `ParseResult.namespace` and `ParseResult.imports`).

Output: `ParsedReference[]`:
```typescript
type ReferenceKind =
  | 'inheritance'
  | 'implementation'
  | 'trait_use'
  | 'instantiation'
  | 'static_call'
  | 'type_hint'
  | 'self_call'
  | 'static_access';

interface ParsedReference {
  sourceQualifiedName: string;  // method/function containing the reference
  targetQualifiedName: string;  // what's being referenced (fully resolved)
  kind: ReferenceKind;
  line: number;
}
```

#### Error Handling

Reference extraction is **best-effort per file** — if extraction fails for a file, the file's symbols are still stored (declarations are more important than references). Errors are logged and counted in the pipeline report. Unresolvable names (e.g., references to vendor/external code) are stored with `target_symbol_id = NULL` — they're still useful as they show the boundary between your code and dependencies.

#### `src/db/repositories/reference-repository.ts`

```
ReferenceRepository
├── replaceFileReferences(fileId, references[]): void
│   DELETE existing refs for file's symbols, INSERT new ones
│
├── resolveTargets(repoId): { resolved: number, unresolved: number }
│   UPDATE symbol_references SET target_symbol_id = s.id
│   FROM symbols s WHERE target_qualified_name = s.qualified_name
│
├── findDependents(symbolId, depth?): SymbolReference[]
│   Reverse walk: who references this symbol? (recursive CTE)
│
└── findDependencies(symbolId, depth?): SymbolReference[]
    Forward walk: what does this symbol reference?
```

#### Pipeline Changes

`IndexPipeline.run()` gains two new steps after step 5 (parse & store):

```
5a. Extract references from each file (using same parsed tree)
5b. Store references via ReferenceRepository.replaceFileReferences()
6.  (moved) Update repo timestamp
7.  Cross-file resolution: ReferenceRepository.resolveTargets(repoId)
8.  (moved) Report — now includes reference count + resolution rate
```

#### Parser Changes

`AstParser.parse()` currently returns `{ symbols, linesOfCode }`. It needs to also return the tree-sitter tree and namespace context so the reference extractor can walk the same tree without re-parsing:

```typescript
// Updated return type from AstParser.parse()
interface AstParseResult {
  symbols: ParsedSymbol[];
  linesOfCode: number;
  tree: Parser.Tree;            // tree-sitter tree for reference extraction
  context: NamespaceContext;    // namespace + imports for name resolution
}
```

The tree-sitter `Parser` instance is created once in `AstParser` and reused. `parsePHP()` currently creates the tree internally — it will return the tree alongside its existing output so the caller can pass it to `ReferenceExtractor`.

#### Source Symbol ID Mapping

`ParsedReference` uses `sourceQualifiedName` for portability between parser and DB layers. The mapping to `source_symbol_id` (required by the DB schema) happens at insertion time in the pipeline:

1. `SymbolRepository.replaceFileSymbols()` already inserts symbols and has their IDs. It will be updated to return a `Map<string, number>` (qualified name → symbol ID).
2. The pipeline passes this map to `ReferenceRepository.replaceFileReferences()`, which uses it to resolve `sourceQualifiedName` → `source_symbol_id` before inserting.

This keeps the parser/extractor layer free of DB concerns.

#### Metadata vs References

The parser currently stores `extends`, `implements`, and `traits` in `ParsedSymbol.metadata`. These will also become `symbol_references` rows (with kinds `inheritance`, `implementation`, `trait_use`). This is intentional — metadata provides quick access on the symbol itself ("what does this class extend?"), while references enable graph queries ("find all classes that extend Model"). Both serve different query patterns.

### CLI Commands

```bash
# Who uses this symbol? (reverse dependency)
cartograph uses "App\Services\UserService::findById"
# Output:
#   App\Http\Controllers\UserController::show (call, line 34)
#   App\Http\Controllers\UserController::update (call, line 45)
#   App\Services\OrderService::create (call, line 67)

# What's the impact of changing this file? (transitive dependents)
cartograph impact src/Services/UserService.php
# Output grouped by layer:
#   Direct dependents (14 files):
#     Controllers: UserController, AdminController, ProfileController
#     Services: OrderService, NotificationService
#     Jobs: SendWelcomeEmailJob
#   Indirect dependents (3 files):
#     Controllers: CheckoutController (via OrderService)

# Trace execution flow forward from an entry point
cartograph trace "App\Http\Controllers\CheckoutController::store"
# Output:
#   1. CheckoutController::store (line 23)
#   2. → OrderService::create (line 45)
#   3.   → UserService::findById (line 67)
#   4.   → PaymentService::charge (line 89)
#   5.     → StripeGateway::process (line 12)
```

Commands accept either qualified names or file paths. When given a file path, operate on all symbols in that file.

### What's Not Included (deferred to 2.2)

- `$variable->method()` calls where `$variable` is not `$this` (needs type inference)
- Service locator / DI container resolution (`app(UserService::class)`, `$container->get()`)
- Symfony YAML service definitions → runtime bindings
- Laravel/Symfony facades (`Cache::get()` → `Illuminate\Cache\CacheManager`)
- Dynamic method calls (`$this->$method()`)

### Testing Strategy

**Unit tests** (`tests/indexer/reference-extractor.test.ts`):
- Extract references from fixture files
- Verify correct qualified name resolution
- Verify correct reference kinds
- Verify line numbers
- Edge cases: self-references, circular references, unresolvable names

**Integration tests** (`tests/integration/reference-resolution.test.ts`):
- Index fixture project → extract references → resolve
- Verify: UserController references UserService (via constructor type hint)
- Verify: UserService implements UserServiceInterface (inheritance)
- Verify: User uses HasTimestamps (trait_use)
- Verify resolution rate (expect high % for fixture project)

**Query tests** (`tests/integration/query-commands.test.ts`):
- `uses` command returns correct dependents
- `impact` command traces transitive dependents
- `trace` command follows call chain forward

### Ship Gate

Run `cartograph uses` and `cartograph impact` on your work codebase. Compare results against your mental model for a method you know well. Resolution rate should be >60% for the static portion.

---

## Milestone 2.2: Dynamic References (Future)

### Scope

Handle the ~30% of references that are dynamic in the codebase:

- **Symfony DI YAML definitions**: Parse `services.yaml` to map service IDs → class names
- **Service locator bridge**: Detect `$this->get(ServiceName::class)` patterns, resolve the class argument
- **Container calls**: `app()`, `$container->get()`, `resolve()` patterns
- **Facade mapping**: Map facade accessors to underlying class (configurable or auto-detected)

### Approach

A new `DynamicResolver` enrichment pass that runs after static resolution:
1. Parse Symfony `services.yaml` → build service ID → class map
2. Walk unresolved references → match patterns → resolve
3. Store with `reference_kind: 'container_resolution'` or `'facade'`

This is a post-processing step, not part of AST extraction. It reads from configuration files + heuristic pattern matching.

### Ship Gate

Resolution rate on your work codebase increases from ~60% (static only) to ~80%+.

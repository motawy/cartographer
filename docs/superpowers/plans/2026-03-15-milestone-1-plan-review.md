# Plan Review: Milestone 1 — PHP Parser & Symbol Indexing

**Reviewer:** Senior Code Reviewer (automated)
**Date:** 2026-03-15
**Verdict:** APPROVE with minor issues noted below

---

## 1. Coverage Against README Milestone 1 Requirements

The README defines Milestone 1 as:

| README Requirement | Plan Coverage | Status |
|---|---|---|
| Project scaffold: TypeScript, Commander.js CLI, Docker Compose | Tasks 1-2 | Covered |
| Database migrations for `files`, `symbols`, `symbol_references` | Task 3 | Covered (plus `repos` table -- good addition) |
| File walker with .gitignore support | Task 5 | Covered |
| PHP Tree-sitter parser: classes, methods, functions, properties | Tasks 6-7 | Covered |
| Namespace resolution for PHP `use` statements | Task 7 | Covered |
| Symbol extraction + database storage | Task 8 | Covered |
| `cartograph index` command works end-to-end | Task 9 | Covered |
| Test on a real Laravel project | Task 10 + validation checklist | Covered (fixture project) |

**All 8 requirements are fully addressed.** No gaps.

---

## 2. Edge Cases and Gaps

### Important (should address before or during implementation)

**2a. Interfaces, traits, and enums in fixtures.**
The `SymbolKind` type correctly includes `interface`, `trait`, and `enum`, but the test fixtures contain only classes. The PHP parser tests therefore never exercise interface/trait/enum extraction. The plan mentions these in the parser spec (Task 7 Step 3 item 1: "class/interface/trait/enum/function declarations") but has no test coverage for them.

**Recommendation:** Add at least one fixture file with a trait (e.g., `HasUuid` trait used by User) and one interface. Enums can be deferred since they are PHP 8.1+ and less critical, but traits are fundamental to Laravel codebases and should be tested in M1.

**2b. Top-level functions.**
PHP files can contain functions outside of classes (common in Laravel helpers, routes). The fixtures and tests only cover class-scoped symbols. The parser spec mentions "function declarations" at top level but no test verifies this.

**Recommendation:** Add a `helpers.php` fixture with a standalone function and a test case.

**2c. Constructor property promotion (PHP 8.0+).**
The `UserController.php` fixture uses `private readonly UserService $userService` in the constructor signature. This is constructor promotion -- the property is declared in the constructor parameters, not as a separate `property_declaration` node. The parser must handle this or it will miss the property entirely.

**Recommendation:** Add a test case that verifies constructor-promoted properties are extracted. Note this in Task 7 as a known AST pattern to handle.

**2d. Abstract classes and methods.**
Not covered in fixtures or tests. Abstract methods have no body, which could affect line_end extraction.

### Suggestions (nice to have)

**2e. Multiple classes per file.**
Rare in PSR-4 projects but not impossible (e.g., exception classes or value objects defined alongside a main class). The parser should handle it; worth a quick test.

**2f. Anonymous classes.**
Used in Laravel tests and factories. The parser should skip or handle them gracefully (they have no meaningful qualified name).

**2g. Group use declarations.**
PHP supports `use App\Models\{User, Order, Product};` syntax. If tree-sitter-php represents these differently than individual use statements, the namespace resolution will break.

---

## 3. Task Ordering and Dependencies

The ordering is **correct and logical**:

```
Task 1 (scaffold) --> Task 2 (docker/db) --> Task 3 (migrations)
                                                    |
Task 4 (fixtures) ----+                             |
                       |                             v
Task 5 (file-walker) --+---> Task 6 (ast setup) --> Task 7 (php parser)
                                                          |
                                                          v
                                      Task 8 (repositories) --> Task 9 (pipeline/CLI) --> Task 10 (integration)
```

No circular dependencies. Each task builds on prior outputs. The TDD approach (write tests first, then implement) is correctly applied in Tasks 5, 7, 8, and 10.

One **minor ordering concern**: Task 6 Step 3 creates `ast-parser.ts` which imports `parsers/php.ts`, but that file is not created until Task 7. This means `tsc --noEmit` will fail between Tasks 6 and 7. This is fine for an agentic executor running them sequentially, but the plan should note that Task 6 is intentionally incomplete until Task 7 is done.

---

## 4. Test Quality Assessment

**Strengths:**
- Tests verify real behavior: qualified name resolution, parent-child relationships, visibility extraction, return types, docblocks, line ranges
- Integration test verifies the full pipeline end-to-end with real Postgres
- Idempotency test is excellent -- catches a common class of bugs
- File walker tests cover exclude patterns, language filtering, hash format, path correctness
- The "replaceFileSymbols is idempotent" test is particularly valuable

**Weaknesses:**
- No test for the `signature` field on methods (e.g., `findById(int $id): ?User`). The repository test hardcodes it but the PHP parser tests never assert on it.
- No test for error handling: what happens when the parser encounters malformed PHP? The plan's `ParseError` class exists but is never tested being thrown.
- No test for the `computeChangeset` logic specifically (it is private, tested only indirectly through the integration test). Consider making it a pure function or testing via the pipeline with modified fixtures.
- The `beforeEach` cleanup in repository tests uses sequential DELETEs rather than TRUNCATE CASCADE, which could leave orphan data if table relationships change.

---

## 5. Conventions Compliance (CLAUDE.md)

| Convention | Compliance | Notes |
|---|---|---|
| Strict TypeScript, no `any` | Mostly compliant | Two `(PHP as any)` casts in ast-parser.ts and explore-ast.ts -- acceptable per CLAUDE.md's Tree-sitter interop exception |
| Database access through repository classes | Compliant | Three repository classes with DI |
| Indexer modules independent, communicate through DB | Compliant | file-walker, ast-parser, parsers/php are independent |
| Dependency injection, no singletons | Compliant | Pool passed via constructors |
| Typed errors | Compliant | `IndexError`, `ParseError`, `DatabaseError` with error codes |
| Config from `.cartograph.yml` + env vars | Compliant | `config.ts` handles both |
| Migrations numbered sequentially | Compliant | 001-004 |

**One deviation from CLAUDE.md:** The CLAUDE.md specifies `GenerateError` as a typed error class. The plan defines `DatabaseError` instead. This is fine for M1 (no generation yet), but `GenerateError` should be added in M3.

**One deviation from README project structure:** The README lists `src/indexer/symbol-extractor.ts` as a separate file. The plan's Design Notes explicitly justify merging this into `ast-parser.ts` + `parsers/php.ts`. This is a **good simplification** -- the justification is sound.

---

## 6. Architectural Concerns for Later Milestones

### Important

**6a. `runMigrations` path resolution.**
The plan notes (Task 8 Step 1) that `runMigrations` should accept `migrationsDir` as a parameter, but Task 3's implementation computes it from `import.meta.url`. The test setup passes a different path. This inconsistency must be resolved during implementation -- the parameterized version is correct. The Task 3 code must be updated before Task 8 tests can run.

**6b. `IndexPipeline` creates its own repositories internally.**
The constructor takes a `pg.Pool` and instantiates `RepoRepository`, `FileRepository`, and `SymbolRepository` internally. This is mild DI violation -- the pipeline should accept repositories as constructor parameters (or a factory) so tests can inject mocks or spies. Currently the integration tests work around this by querying the DB directly, which is fine but fragile.

**6c. `symbol_references` table created but unused.**
The plan correctly creates the table in M1 and defers population to M2. However, the `source_symbol_id` column is `NOT NULL`, which means any M1 code that accidentally touches this table will need valid symbol IDs. This is fine as-is but worth noting.

### Suggestions

**6d. The `ParseResult.imports` field uses `Map<string, string>`.**
Maps do not serialize to JSON. If any future code needs to serialize parse results (caching, logging, debugging), this will require conversion. Consider whether a plain object `Record<string, string>` would be better.

**6e. No `DATABASE_URL` support.**
The README configuration section mentions `# Or use DATABASE_URL env var` but the plan's config loader only supports individual env vars (`CARTOGRAPH_DB_HOST`, etc.). Not critical for M1 but should be added.

---

## Summary

The plan is thorough, well-structured, and covers all Milestone 1 requirements. The task ordering is correct, the test strategy verifies real behavior, and the code follows CLAUDE.md conventions faithfully. The three most important items to address:

1. **Add trait/interface fixtures and tests** -- traits are fundamental to Laravel and must be tested
2. **Handle constructor property promotion** -- the fixture already uses it, parser must handle it
3. **Parameterize `runMigrations` path from the start** -- avoid refactoring mid-milestone

Everything else is minor or deferrable. The plan is ready for implementation.

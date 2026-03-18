import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { IndexPipeline } from '../../src/indexer/pipeline.js';
import { join } from 'path';
import type { CartographConfig } from '../../src/types.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'laravel-sample');

function testConfig(): CartographConfig {
  return {
    languages: ['php'],
    exclude: ['vendor/'],
    database: { path: ':memory:' },
  };
}

describe('Reference Resolution (Integration)', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = openDatabase({ path: ':memory:' });
    runMigrations(db);
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

  it('creates references during indexing', () => {
    const pipeline = new IndexPipeline(db);
    pipeline.run(FIXTURES, testConfig());

    const row = db.prepare(
      'SELECT COUNT(*) AS count FROM symbol_references'
    ).get() as { count: number };
    expect(row.count).toBeGreaterThan(0);
  });

  it('resolves cross-file implementation references', () => {
    const pipeline = new IndexPipeline(db);
    pipeline.run(FIXTURES, testConfig());

    const rows = db.prepare(
      `SELECT sr.* FROM symbol_references sr
       JOIN symbols s ON sr.source_symbol_id = s.id
       WHERE s.qualified_name = ?
         AND sr.reference_kind = 'implementation'`
    ).all('App\\Services\\UserService') as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].target_qualified_name).toBe('app\\contracts\\userserviceinterface');
    expect(rows[0].target_symbol_id).not.toBeNull();
  });

  it('leaves external inheritance references unresolved', () => {
    const pipeline = new IndexPipeline(db);
    pipeline.run(FIXTURES, testConfig());

    const rows = db.prepare(
      `SELECT sr.* FROM symbol_references sr
       JOIN symbols s ON sr.source_symbol_id = s.id
       WHERE s.qualified_name = ?
         AND sr.reference_kind = 'inheritance'`
    ).all('App\\Models\\User') as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].target_symbol_id).toBeNull();
  });

  it('resolves trait use references', () => {
    const pipeline = new IndexPipeline(db);
    pipeline.run(FIXTURES, testConfig());

    const rows = db.prepare(
      `SELECT sr.* FROM symbol_references sr
       JOIN symbols s ON sr.source_symbol_id = s.id
       WHERE s.qualified_name = ?
         AND sr.reference_kind = 'trait_use'`
    ).all('App\\Models\\User') as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].target_qualified_name).toBe('app\\traits\\hastimestamps');
    expect(rows[0].target_symbol_id).not.toBeNull();
  });

  it('stores type hint references', () => {
    const pipeline = new IndexPipeline(db);
    pipeline.run(FIXTURES, testConfig());

    const rows = db.prepare(
      `SELECT sr.* FROM symbol_references sr
       JOIN symbols s ON sr.source_symbol_id = s.id
       WHERE s.qualified_name = ?
         AND sr.reference_kind = 'type_hint'`
    ).all('App\\Services\\UserService::findById') as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) =>
      r.target_qualified_name === 'app\\models\\user'
    )).toBe(true);
  });

  it('stores static call references', () => {
    const pipeline = new IndexPipeline(db);
    pipeline.run(FIXTURES, testConfig());

    const rows = db.prepare(
      `SELECT sr.* FROM symbol_references sr
       JOIN symbols s ON sr.source_symbol_id = s.id
       WHERE s.qualified_name = ?
         AND sr.reference_kind = 'static_call'`
    ).all('App\\Repositories\\UserRepository::find') as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].target_qualified_name).toBe('app\\models\\user::find');
  });

  it('resolves Class::method references to class symbol via fallback', () => {
    const pipeline = new IndexPipeline(db);
    pipeline.run(FIXTURES, testConfig());

    // User::find() — find() is inherited from Model, not defined on User.
    // Pass 2 strips ::find and resolves to the User class symbol.
    const rows = db.prepare(
      `SELECT sr.target_symbol_id FROM symbol_references sr
       JOIN symbols s ON sr.source_symbol_id = s.id
       WHERE s.qualified_name = ?
         AND sr.reference_kind = 'static_call'
         AND sr.target_qualified_name = ?`
    ).all('App\\Repositories\\UserRepository::find', 'app\\models\\user::find') as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].target_symbol_id).not.toBeNull();

    // Verify it resolved to the User class
    const target = db.prepare(
      'SELECT qualified_name FROM symbols WHERE id = ?'
    ).all(rows[0].target_symbol_id as number) as Record<string, unknown>[];
    expect(target[0].qualified_name).toBe('App\\Models\\User');
  });

  it('reference count is reasonable for fixture project', () => {
    const pipeline = new IndexPipeline(db);
    pipeline.run(FIXTURES, testConfig());

    const row = db.prepare(
      'SELECT COUNT(*) AS count FROM symbol_references'
    ).get() as { count: number };
    expect(row.count).toBeGreaterThanOrEqual(15);
    expect(row.count).toBeLessThan(60);
  });

  it('is idempotent — re-indexing produces same reference count', () => {
    const pipeline = new IndexPipeline(db);
    const config = testConfig();

    pipeline.run(FIXTURES, config);
    const first = db.prepare(
      'SELECT COUNT(*) AS count FROM symbol_references'
    ).get() as { count: number };

    // Force re-parse by clearing hashes
    db.exec("UPDATE files SET hash = 'stale'");
    pipeline.run(FIXTURES, config);
    const second = db.prepare(
      'SELECT COUNT(*) AS count FROM symbol_references'
    ).get() as { count: number };

    expect(first.count).toBe(second.count);
  });
});

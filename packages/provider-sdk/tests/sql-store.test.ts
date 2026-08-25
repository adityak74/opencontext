import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SqlContextStore } from '../src/base/sql-store.js';
import { SqliteDialect, PostgresDialect } from '../src/base/sql-dialects.js';
import { runProviderConformanceSuite } from '../src/testing/conformance.js';

describe('SqlContextStore (SQLite)', () => {
  let db: DatabaseSync;

  runProviderConformanceSuite('SqlContextStore - SQLite', {
    create: async () => {
      db = new DatabaseSync(':memory:');
      const driver = {
        query: async (sql: string, params: any[] = []) => {
          const stmt = db.prepare(sql);
          return stmt.all(...params);
        },
        exec: async (sql: string, params: any[] = []) => {
          const stmt = db.prepare(sql);
          const res = stmt.run(...params);
          return { changes: Number(res.changes) };
        },
        close: async () => {
          try {
            db.close();
          } catch {
            // ignore if already closed
          }
        },
      };
      return new SqlContextStore('sqlite', new SqliteDialect(), driver);
    },
    cleanup: async () => {
      try {
        db?.close();
      } catch {
        // ignore if already closed
      }
    },
  });
});

describe('SQL Dialects', () => {
  it('generates correct SQL statements and placeholders for SQLite', () => {
    const dialect = new SqliteDialect();
    expect(dialect.name).toBe('sqlite');
    expect(dialect.placeholder(1)).toBe('?');
    expect(dialect.placeholder(5)).toBe('?');
    const tableSql = dialect.createTableSql();
    expect(tableSql).toContain('CREATE TABLE IF NOT EXISTS contexts');
    expect(tableSql).toContain('content_json TEXT NOT NULL');
    expect(tableSql).toContain('idx_contexts_query');
  });

  it('generates correct SQL statements and positional placeholders for PostgreSQL', () => {
    const dialect = new PostgresDialect();
    expect(dialect.name).toBe('postgres');
    expect(dialect.placeholder(1)).toBe('$1');
    expect(dialect.placeholder(5)).toBe('$5');
    const tableSql = dialect.createTableSql();
    expect(tableSql).toContain('CREATE TABLE IF NOT EXISTS contexts');
    expect(tableSql).toContain('content_json JSONB NOT NULL');
    expect(tableSql).toContain('idx_pg_contexts');
  });

  it('executes queries with Postgres positional parameter syntax', async () => {
    const executedQueries: Array<{ sql: string; params: any[] }> = [];
    const mockDriver = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params });
        return [];
      },
      exec: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params });
        return { changes: 1 };
      },
      close: async () => {},
    };

    const pgStore = new SqlContextStore('pg-test', new PostgresDialect(), mockDriver);
    await pgStore.connect();
    expect(executedQueries.length).toBeGreaterThanOrEqual(1);
    expect(executedQueries[0].sql).toContain('CREATE TABLE IF NOT EXISTS contexts');

    await pgStore.get('ctx-1', 'ns-1');
    const getQuery = executedQueries[executedQueries.length - 1];
    expect(getQuery.sql).toContain('WHERE id = $1 AND namespace = $2');
    expect(getQuery.params).toEqual(['ctx-1', 'ns-1']);

    await pgStore.query({
      namespace: 'ns-1',
      scope: ['scope-a', 'scope-b'],
      types: ['decision'],
      lifecycle: ['active'],
      fullText: 'test',
    });
    const complexQuery = executedQueries[executedQueries.length - 1];
    expect(complexQuery.sql).toContain('namespace = $1');
    expect(complexQuery.sql).toContain('scope IN ($2, $3)');
    expect(complexQuery.sql).toContain('type IN ($4)');
    expect(complexQuery.sql).toContain('lifecycle IN ($5)');
    expect(complexQuery.sql).toContain('(content_json LIKE $6 OR metadata_json LIKE $7)');
    expect(complexQuery.params).toEqual(['ns-1', 'scope-a', 'scope-b', 'decision', 'active', '%test%', '%test%']);
  });

  it('searches across both content_json and metadata_json with fullText', async () => {
    const { createCanonicalContext } = await import('@opencontext/core');
    const memDb = new DatabaseSync(':memory:');
    const driver = {
      query: async (sql: string, params: any[] = []) => {
        const stmt = memDb.prepare(sql);
        return stmt.all(...params);
      },
      exec: async (sql: string, params: any[] = []) => {
        const stmt = memDb.prepare(sql);
        const res = stmt.run(...params);
        return { changes: Number(res.changes) };
      },
      close: async () => {
        try {
          memDb.close();
        } catch {}
      },
    };
    const store = new SqlContextStore('sqlite-test', new SqliteDialect(), driver);
    await store.connect();

    const c1 = createCanonicalContext({
      content: { text: 'General notes' },
      metadata: { tags: ['critical-architecture', 'backend'] },
    });
    await store.put(c1);

    const res = await store.query({ namespace: 'default', fullText: 'critical-architecture' });
    expect(res.items.length).toBe(1);
    expect(res.items[0].id).toBe(c1.id);
  });
});


import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { QUESTION_MARK_DIALECT, type SqlDriver } from '../adapters/sql.js';
import { importOptional } from './optional.js';
import type { ParsedDsn } from '../dsn.js';

/**
 * The slice of `@duckdb/node-api` this driver uses, verified against 1.5.5-r.4.
 *
 * `run` and `runAndReadAll` both take the bind values as their second argument
 * and resolve once the statement has finished, so no separate prepare step is
 * needed. `getRowObjects` hands back plain JS values — every column in the
 * schema is TEXT, which DuckDB returns as a JS string and SQL NULL as `null`.
 */
interface DuckDbConnection {
  run(sql: string, values?: unknown[]): Promise<unknown>;
  runAndReadAll(sql: string, values?: unknown[]): Promise<{ getRowObjects(): unknown[] }>;
  closeSync(): void;
}

interface DuckDbInstance {
  connect(): Promise<DuckDbConnection>;
  closeSync(): void;
}

/**
 * DuckDB — embedded, column-oriented, and the right pick when the context store
 * is large enough that people want to run analytical queries over it directly.
 *
 * Uses the same SQL as SQLite and Postgres, so it shares the standard dialect:
 * `?` placeholders, `CREATE TABLE/INDEX IF NOT EXISTS` and `||` concatenation
 * all behave as that dialect expects.
 */
export async function createDuckDbDriver(dsn: ParsedDsn): Promise<SqlDriver> {
  const { DuckDBInstance } = await importOptional<{
    DuckDBInstance: { create(path: string): Promise<DuckDbInstance> };
  }>('@duckdb/node-api', 'duckdb');

  const path = dsn.path!;
  if (path !== ':memory:') {
    const directory = dirname(path);
    if (directory && !existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }
  }

  const instance = await DuckDBInstance.create(path);
  const connection = await instance.connect();

  return {
    dialect: QUESTION_MARK_DIALECT('duckdb'),

    async exec(sql) {
      await connection.run(sql);
    },

    async run(sql, params) {
      await connection.run(sql, params);
    },

    async all<T>(sql: string, params: unknown[]) {
      const reader = await connection.runAndReadAll(sql, params);
      return reader.getRowObjects() as T[];
    },

    async close() {
      // The instance owns the database handle; closing only the connection
      // leaves it — and the several megabytes of buffer pool behind it — alive
      // for the lifetime of the process. Both have to go.
      connection.closeSync();
      instance.closeSync();
    },
  };
}

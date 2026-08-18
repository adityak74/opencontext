import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { QUESTION_MARK_DIALECT, type SqlDriver } from '../adapters/sql.js';
import { importOptional } from './optional.js';
import type { ParsedDsn } from '../dsn.js';

/**
 * Local SQLite via `node:sqlite`, which ships with Node — no dependency to
 * install, which is why SQLite is the recommended first step up from JSON.
 *
 * The module is synchronous; every method is wrapped in a promise so it satisfies
 * the same `SqlDriver` contract as the genuinely async drivers.
 */
export async function createSqliteDriver(dsn: ParsedDsn): Promise<SqlDriver> {
  const { DatabaseSync } = await import('node:sqlite');

  const path = dsn.path!;
  if (path !== ':memory:') {
    const directory = dirname(path);
    if (directory && !existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  return {
    dialect: QUESTION_MARK_DIALECT('sqlite'),

    async exec(sql) {
      db.exec(sql);
    },

    async run(sql, params) {
      db.prepare(sql).run(...(params as never[]));
    },

    async all<T>(sql: string, params: unknown[]) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },

    async close() {
      db.close();
    },
  };
}

interface LibsqlClient {
  execute(statement: string | { sql: string; args: unknown[] }): Promise<{ rows: unknown[] }>;
  close(): void;
}

/**
 * Remote SQLite over libSQL (Turso and self-hosted sqld).
 *
 * Same dialect as local SQLite — only the transport differs.
 */
export async function createLibsqlDriver(dsn: ParsedDsn): Promise<SqlDriver> {
  const { createClient } = await importOptional<{
    createClient: (config: Record<string, unknown>) => LibsqlClient;
  }>('@libsql/client', 'libsql');

  const authToken = dsn.params.authToken ?? dsn.params.auth_token;
  // Strip the token from the URL — libsql takes it as a separate option and
  // would otherwise see it twice.
  const url = dsn.raw.replace(/[?&](authToken|auth_token)=[^&]*/g, '').replace(/\?$/, '');

  const client = createClient(authToken ? { url, authToken } : { url });

  return {
    dialect: QUESTION_MARK_DIALECT('libsql'),

    async exec(sql) {
      await client.execute(sql);
    },

    async run(sql, params) {
      await client.execute({ sql, args: params as never[] });
    },

    async all<T>(sql: string, params: unknown[]) {
      const result = await client.execute({ sql, args: params as never[] });
      return result.rows as unknown as T[];
    },

    async close() {
      client.close();
    },
  };
}

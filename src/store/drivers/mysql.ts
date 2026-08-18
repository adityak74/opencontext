import { MYSQL_DIALECT, type SqlDriver } from '../adapters/sql.js';
import { importOptional } from './optional.js';
import type { ParsedDsn } from '../dsn.js';

interface MysqlPool {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
  execute(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
  end(): Promise<void>;
}

type SslOption = undefined | { rejectUnauthorized: boolean };

/**
 * Translate a TLS request into what `mysql2` expects.
 *
 * Both spellings are accepted: `sslmode`, which is what Postgres users type and
 * what the sibling driver takes, and MySQL's own `ssl-mode` vocabulary. As with
 * Postgres, `require` encrypts without verifying, because managed MySQL — RDS,
 * Cloud SQL, Azure — presents a chain Node does not trust out of the box;
 * verification is opt-in and, unlike before, is actually honoured when asked for.
 */
function sslOptionFor(dsn: ParsedDsn): SslOption {
  const mode = (dsn.params.sslmode ?? dsn.params['ssl-mode'])?.toLowerCase();
  switch (mode) {
    case 'disable':
    case 'disabled':
      return undefined;
    case 'require':
    case 'required':
    case 'prefer':
    case 'preferred':
    case 'allow':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify_ca':
    case 'verify-full':
    case 'verify-identity':
    case 'verify_identity':
      return { rejectUnauthorized: true };
    default:
      // `?ssl=true` predates the modes and stays an alias for unverified TLS.
      return dsn.params.ssl === 'true' ? { rejectUnauthorized: false } : undefined;
  }
}

/**
 * MySQL and MariaDB, which also covers PlanetScale, Azure Database for MySQL,
 * Cloud SQL for MySQL, and Aurora MySQL — they all speak the same wire protocol.
 */
export async function createMysqlDriver(dsn: ParsedDsn): Promise<SqlDriver> {
  const mysql = await importOptional<{ createPool(config: unknown): MysqlPool }>(
    'mysql2/promise',
    'mysql',
    'mysql2',
  );

  const config: Record<string, unknown> = {
    host: dsn.host,
    port: dsn.port,
    user: dsn.username,
    password: dsn.password,
    database: dsn.database,
    // Without this, `?` inside a string literal can be mistaken for a parameter.
    namedPlaceholders: false,
    // Pinned to match the utf8mb4 schema. The driver already defaults to
    // utf8mb4, but an implicit default is a poor thing to rest emoji on.
    charset: 'utf8mb4',
  };
  const ssl = sslOptionFor(dsn);
  if (ssl !== undefined) {
    config.ssl = ssl;
  }

  const pool = mysql.createPool(config);

  return {
    dialect: MYSQL_DIALECT,

    async exec(sql) {
      // DDL only, and never parameterised, so the text goes as-is.
      await pool.query(sql);
    },

    async run(sql, params) {
      await pool.execute(sql, params);
    },

    async all<T>(sql: string, params: unknown[]) {
      const [rows] = await pool.execute(sql, params);
      return rows as T[];
    },

    async close() {
      await pool.end();
    },
  };
}

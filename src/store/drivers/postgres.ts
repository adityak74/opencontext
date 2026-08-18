import { NUMBERED_DIALECT, type SqlDriver } from '../adapters/sql.js';
import { importOptional } from './optional.js';
import type { ParsedDsn } from '../dsn.js';

type SslOption = false | { rejectUnauthorized: boolean } | undefined;

/**
 * Translate `sslmode` into what `pg` expects.
 *
 * Managed Postgres — Google Cloud SQL, Azure Database for PostgreSQL, Neon,
 * Supabase, RDS — generally requires TLS but presents a chain Node does not
 * trust out of the box, so `require` encrypts without verifying. Callers who
 * want verification ask for it explicitly with `verify-ca` or `verify-full`.
 */
function sslOptionFor(mode: string | undefined): SslOption {
  switch (mode) {
    case 'disable':
      return false;
    case 'require':
    case 'prefer':
    case 'allow':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true };
    default:
      return undefined;
  }
}

type PgPool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; end: () => Promise<void> };

function loadPg(scheme: 'postgres' | 'cloudsql') {
  return importOptional<{ Pool: new (config: unknown) => PgPool }>('pg', scheme, 'pg');
}

function toDriver(pool: PgPool, name: string): SqlDriver {
  return {
    dialect: NUMBERED_DIALECT(name),

    async exec(sql) {
      await pool.query(sql);
    },

    async run(sql, params) {
      await pool.query(sql, params);
    },

    async all<T>(sql: string, params: unknown[]) {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },

    async close() {
      await pool.end();
    },
  };
}

/**
 * Postgres over the wire.
 *
 * This covers self-hosted Postgres and every managed flavour that exposes a
 * standard endpoint, including Azure Database for PostgreSQL and Cloud SQL
 * reached by IP. Cloud SQL reached by instance connection name uses
 * `createCloudSqlDriver` below instead.
 */
export async function createPostgresDriver(dsn: ParsedDsn): Promise<SqlDriver> {
  const pg = await loadPg('postgres');

  const ssl = sslOptionFor(dsn.params.sslmode);
  const config: Record<string, unknown> = { connectionString: dsn.raw };
  if (ssl !== undefined) {
    config.ssl = ssl;
  }

  return toDriver(new pg.Pool(config), 'postgres');
}

/**
 * Google Cloud SQL for PostgreSQL, addressed by instance connection name.
 *
 * The official connector handles TLS and, when no password is supplied, IAM
 * database authentication — neither of which a plain `postgres://` URL can do.
 * It is what makes `project:region:instance` addressing work without pinning an
 * IP or running the auth proxy as a sidecar.
 */
export async function createCloudSqlDriver(dsn: ParsedDsn): Promise<SqlDriver> {
  const pg = await loadPg('cloudsql');
  const { Connector } = await importOptional<{
    Connector: new () => {
      getOptions(opts: Record<string, unknown>): Promise<Record<string, unknown>>;
      close(): void;
    };
  }>('@google-cloud/cloud-sql-connector', 'cloudsql', '@google-cloud/cloud-sql-connector pg');

  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: dsn.instance!,
    ipType: (dsn.params.ipType ?? 'PUBLIC').toUpperCase(),
    // No password means IAM database authentication.
    authType: dsn.password ? 'PASSWORD' : 'IAM',
  });

  const pool = new pg.Pool({
    ...clientOpts,
    user: dsn.username,
    password: dsn.password,
    database: dsn.database,
  });

  const driver = toDriver(pool, 'cloudsql');
  const closePool = driver.close.bind(driver);
  return {
    ...driver,
    async close() {
      await closePool();
      connector.close();
    },
  };
}

import {
  InvalidDsnError,
  type ContextStoreAdapter,
  type AdapterInfo,
  type DbScheme,
} from './types.js';
import { parseDsn, redactDsn, type ParsedDsn } from './dsn.js';
import { createSqlAdapter } from './adapters/sql.js';
import { createDocumentAdapter } from './adapters/document.js';
import { createJsonAdapter } from './adapters/json.js';
import { createSurrealAdapter } from './adapters/surreal.js';

export interface AdapterDescriptor {
  scheme: DbScheme;
  label: string;
  /** What the user types, with the parts they must replace spelled out. */
  example: string;
  /** npm package needed to use it, or null when nothing needs installing. */
  packageName: string | null;
  remote: boolean;
  family: 'file' | 'sql' | 'document';
}

/**
 * Every backend opencontext can open.
 *
 * `packageName: null` means the backend works out of the box — either it uses
 * only Node built-ins (json, memory, sqlite) or it speaks plain HTTP (d1).
 */
export const ADAPTERS: AdapterDescriptor[] = [
  { scheme: 'json', label: 'JSON file', example: 'json:///path/to/contexts.json', packageName: null, remote: false, family: 'file' },
  { scheme: 'memory', label: 'In-memory (ephemeral)', example: 'memory://', packageName: null, remote: false, family: 'document' },
  { scheme: 'sqlite', label: 'SQLite', example: 'sqlite:///path/to/opencontext.db', packageName: null, remote: false, family: 'sql' },
  { scheme: 'duckdb', label: 'DuckDB', example: 'duckdb:///path/to/opencontext.duckdb', packageName: '@duckdb/node-api', remote: false, family: 'sql' },
  { scheme: 'libsql', label: 'libSQL / Turso', example: 'libsql://DATABASE.turso.io?authToken=TOKEN', packageName: '@libsql/client', remote: true, family: 'sql' },
  { scheme: 'd1', label: 'Cloudflare D1', example: 'd1://ACCOUNT_ID/DATABASE_ID?apiToken=TOKEN', packageName: null, remote: true, family: 'sql' },
  { scheme: 'postgres', label: 'PostgreSQL', example: 'postgres://USER:PASSWORD@HOST:5432/DATABASE', packageName: 'pg', remote: true, family: 'sql' },
  { scheme: 'cloudsql', label: 'Google Cloud SQL', example: 'cloudsql://USER:PASSWORD@PROJECT:REGION:INSTANCE/DATABASE', packageName: '@google-cloud/cloud-sql-connector', remote: true, family: 'sql' },
  { scheme: 'mysql', label: 'MySQL / MariaDB', example: 'mysql://USER:PASSWORD@HOST:3306/DATABASE', packageName: 'mysql2', remote: true, family: 'sql' },
  { scheme: 'mssql', label: 'SQL Server / Azure SQL', example: 'mssql://USER:PASSWORD@HOST:1433/DATABASE', packageName: 'mssql', remote: true, family: 'sql' },
  { scheme: 'mongodb', label: 'MongoDB', example: 'mongodb://USER:PASSWORD@HOST:27017/DATABASE', packageName: 'mongodb', remote: true, family: 'document' },
  { scheme: 'redis', label: 'Redis / Valkey', example: 'redis://HOST:6379', packageName: 'redis', remote: true, family: 'document' },
  { scheme: 'firestore', label: 'Google Firestore', example: 'firestore://PROJECT_ID', packageName: '@google-cloud/firestore', remote: true, family: 'document' },
  { scheme: 'dynamodb', label: 'Amazon DynamoDB', example: 'dynamodb://REGION/TABLE', packageName: '@aws-sdk/client-dynamodb', remote: true, family: 'document' },
  { scheme: 'surrealdb', label: 'SurrealDB', example: 'surrealdb://USER:PASSWORD@HOST:8000/NAMESPACE/DATABASE', packageName: 'surrealdb', remote: true, family: 'document' },
];

export function describeAdapter(scheme: DbScheme): AdapterDescriptor {
  const found = ADAPTERS.find((adapter) => adapter.scheme === scheme);
  if (!found) {
    throw new InvalidDsnError(`No adapter registered for scheme "${scheme}".`);
  }
  return found;
}

/** Is the optional driver for this backend importable right now? */
export async function isDriverInstalled(scheme: DbScheme): Promise<boolean> {
  const { packageName } = describeAdapter(scheme);
  if (!packageName) {
    return true;
  }
  // Only the first package is probed; the rest install alongside it.
  const specifier = packageName.split(' ')[0]!;
  try {
    await import(/* @vite-ignore */ specifier);
    return true;
  } catch {
    return false;
  }
}

function infoFor(dsn: ParsedDsn): AdapterInfo {
  const descriptor = describeAdapter(dsn.scheme);
  return {
    scheme: dsn.scheme,
    label: descriptor.label,
    target: dsn.path ?? redactDsn(dsn.raw),
    remote: dsn.remote,
  };
}

/**
 * Build an adapter for a connection string.
 *
 * Each driver is imported only when its scheme is actually used, so nothing pays
 * for backends it does not touch — including at build time, where none of the
 * optional packages need to be present.
 */
async function build(dsn: ParsedDsn): Promise<ContextStoreAdapter> {
  const info = infoFor(dsn);

  switch (dsn.scheme) {
    // ---- file ------------------------------------------------------------
    case 'json':
      return createJsonAdapter(dsn);

    // ---- SQL -------------------------------------------------------------
    case 'sqlite': {
      const { createSqliteDriver } = await import('./drivers/sqlite.js');
      return createSqlAdapter(await createSqliteDriver(dsn), info);
    }
    case 'libsql': {
      const { createLibsqlDriver } = await import('./drivers/sqlite.js');
      return createSqlAdapter(await createLibsqlDriver(dsn), info);
    }
    case 'd1': {
      const { createD1Driver } = await import('./drivers/d1.js');
      return createSqlAdapter(await createD1Driver(dsn), info);
    }
    case 'duckdb': {
      const { createDuckDbDriver } = await import('./drivers/duckdb.js');
      return createSqlAdapter(await createDuckDbDriver(dsn), info);
    }
    case 'postgres': {
      const { createPostgresDriver } = await import('./drivers/postgres.js');
      return createSqlAdapter(await createPostgresDriver(dsn), info);
    }
    case 'cloudsql': {
      const { createCloudSqlDriver } = await import('./drivers/postgres.js');
      return createSqlAdapter(await createCloudSqlDriver(dsn), info);
    }
    case 'mysql': {
      const { createMysqlDriver } = await import('./drivers/mysql.js');
      return createSqlAdapter(await createMysqlDriver(dsn), info);
    }
    case 'mssql': {
      const { createMssqlDriver } = await import('./drivers/mssql.js');
      return createSqlAdapter(await createMssqlDriver(dsn), info);
    }

    // ---- document / key-value -------------------------------------------
    case 'memory': {
      const { createMemoryDriver } = await import('./drivers/memory.js');
      // `memory://scratch` names an independent store; `memory://` is the default.
      const name = dsn.path?.replace(/^\/*/, '') || 'default';
      return createDocumentAdapter(createMemoryDriver(name), info);
    }
    case 'mongodb': {
      const { createMongoDriver } = await import('./drivers/mongodb.js');
      return createDocumentAdapter(await createMongoDriver(dsn), info);
    }
    case 'redis': {
      const { createRedisDriver } = await import('./drivers/redis.js');
      return createDocumentAdapter(await createRedisDriver(dsn), info);
    }
    case 'firestore': {
      const { createFirestoreDriver } = await import('./drivers/firestore.js');
      return createDocumentAdapter(await createFirestoreDriver(dsn), info);
    }
    case 'dynamodb': {
      const { createDynamoDbDriver } = await import('./drivers/dynamodb.js');
      return createDocumentAdapter(await createDynamoDbDriver(dsn), info);
    }

    // ---- multi-model -----------------------------------------------------
    case 'surrealdb':
      return createSurrealAdapter(dsn, info);

    default: {
      const exhaustive: never = dsn.scheme;
      throw new InvalidDsnError(`Unsupported scheme "${String(exhaustive)}".`);
    }
  }
}

/**
 * Open a connected store for a connection string.
 *
 * The adapter is returned already connected, so callers never have to remember
 * to call `connect()` and no backend can be used half-initialised.
 */
export async function createStore(url: string): Promise<ContextStoreAdapter> {
  const dsn = parseDsn(url);
  const adapter = await build(dsn);
  await adapter.connect();
  return adapter;
}

export { parseDsn, redactDsn } from './dsn.js';
export * from './types.js';

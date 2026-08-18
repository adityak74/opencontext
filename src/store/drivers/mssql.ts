import { MSSQL_DIALECT, type SqlDriver } from '../adapters/sql.js';
import { importOptional } from './optional.js';
import type { ParsedDsn } from '../dsn.js';

interface MssqlRequest {
  input(name: string, value: unknown): MssqlRequest;
  query(sql: string): Promise<{ recordset: unknown[] }>;
  batch(sql: string): Promise<unknown>;
}

interface MssqlPool {
  request(): MssqlRequest;
  connect(): Promise<MssqlPool>;
  close(): Promise<void>;
}

interface MssqlModule {
  ConnectionPool: new (config: unknown) => MssqlPool;
}

/**
 * SQL Server error numbers meaning "the thing this statement creates is already
 * there": 2714 for a table, 1913 for an index.
 *
 * `IF OBJECT_ID(…) IS NULL CREATE TABLE …` is a check followed by a create, not
 * one atomic step, so two processes opening the same fresh database at the same
 * moment can both find nothing and both try to create it. One wins, the other
 * gets these. The loser's intent is already satisfied, so it is not an error.
 */
const ALREADY_EXISTS = new Set([2714, 1913]);

function isAlreadyExists(error: unknown): boolean {
  return ALREADY_EXISTS.has((error as { number?: number }).number ?? -1);
}

/**
 * SQL Server, including Azure SQL Database.
 *
 * Azure requires TLS, so `encrypt` defaults to on here — the opposite of the
 * driver's own default, and the setting people most often get wrong.
 *
 * Note that Azure SQL usernames frequently contain `@` (`admin@myserver`); those
 * must be percent-encoded in the connection string or the URL parser reads the
 * `@` as the credential separator.
 */
export async function createMssqlDriver(dsn: ParsedDsn): Promise<SqlDriver> {
  const mssql = await importOptional<MssqlModule>('mssql', 'mssql');

  const isAzure = (dsn.host ?? '').endsWith('.database.windows.net');
  const encrypt = dsn.params.encrypt ? dsn.params.encrypt !== 'false' : true;

  // A dedicated pool, never `mssql.connect()` — that helper caches one global
  // pool per process, so a second store would silently reuse the first one's
  // server and database, and the first `close()` would disconnect them all.
  const pool = new mssql.ConnectionPool({
    server: dsn.host,
    port: dsn.port,
    user: dsn.username,
    password: dsn.password,
    database: dsn.database,
    options: {
      encrypt,
      // Self-signed certificates are normal for local SQL Server and never for
      // Azure, so trust follows the host rather than being a flag people forget.
      trustServerCertificate: dsn.params.trustServerCertificate
        ? dsn.params.trustServerCertificate !== 'false'
        : !isAzure,
    },
  });

  await pool.connect();

  function requestWith(params: unknown[]): MssqlRequest {
    const request = pool.request();
    params.forEach((value, index) => request.input(`p${index + 1}`, value));
    return request;
  }

  return {
    dialect: MSSQL_DIALECT,

    async exec(sql) {
      // `batch` rather than `query`, because the schema DDL uses `IF NOT EXISTS`
      // control flow that SQL Server rejects inside a parameterised statement.
      try {
        await pool.request().batch(sql);
      } catch (error) {
        if (!isAlreadyExists(error)) {
          throw error;
        }
      }
    },

    async run(sql, params) {
      await requestWith(params).query(sql);
    },

    async all<T>(sql: string, params: unknown[]) {
      const result = await requestWith(params).query(sql);
      return result.recordset as T[];
    },

    async close() {
      await pool.close();
    },
  };
}

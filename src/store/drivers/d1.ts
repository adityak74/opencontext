import { QUESTION_MARK_DIALECT, type SqlDriver } from '../adapters/sql.js';
import { InvalidDsnError } from '../types.js';
import type { ParsedDsn } from '../dsn.js';

interface D1Response {
  success: boolean;
  errors?: { message: string }[];
  result?: { results?: unknown[] }[];
}

/**
 * Cloudflare D1 over its HTTP API.
 *
 * D1 is SQLite, so it shares the standard dialect. This driver talks to the REST
 * endpoint with `fetch`, which means it needs no dependency at all — the one
 * remote backend with nothing to install.
 */
export async function createD1Driver(dsn: ParsedDsn): Promise<SqlDriver> {
  const token = dsn.params.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new InvalidDsnError(
      'Cloudflare D1 needs an API token. Pass it as ?apiToken=… or set CLOUDFLARE_API_TOKEN.',
    );
  }

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${dsn.accountId}` +
    `/d1/database/${dsn.databaseId}/query`;

  async function send(sql: string, params: unknown[]): Promise<unknown[]> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    const body = (await response.json()) as D1Response;
    if (!response.ok || !body.success) {
      const detail = body.errors?.map((e) => e.message).join('; ') ?? response.statusText;
      throw new Error(`Cloudflare D1 query failed: ${detail}`);
    }
    return body.result?.[0]?.results ?? [];
  }

  return {
    dialect: QUESTION_MARK_DIALECT('d1'),
    async exec(sql) {
      await send(sql, []);
    },
    async run(sql, params) {
      await send(sql, params);
    },
    async all<T>(sql: string, params: unknown[]) {
      return (await send(sql, params)) as T[];
    },
    async close() {
      // Stateless HTTP — nothing to release.
    },
  };
}

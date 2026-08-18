import { InvalidDsnError, type DbScheme } from './types.js';

export const SUPPORTED_SCHEMES: DbScheme[] = [
  'json',
  'memory',
  'sqlite',
  'duckdb',
  'libsql',
  'd1',
  'postgres',
  'cloudsql',
  'mysql',
  'mssql',
  'mongodb',
  'redis',
  'firestore',
  'dynamodb',
  'surrealdb',
];

/** Schemes that address a file on disk rather than a network endpoint. */
const FILE_SCHEMES = new Set<DbScheme>(['json', 'memory', 'sqlite', 'duckdb']);

/** Alternate spellings users reasonably expect to work. */
const SCHEME_ALIASES: Record<string, DbScheme> = {
  postgresql: 'postgres',
  ws: 'surrealdb',
  wss: 'surrealdb',
  surreal: 'surrealdb',
  sqlserver: 'mssql',
  azuresql: 'mssql',
  ddb: 'dynamodb',
  mariadb: 'mysql',
  'mongodb+srv': 'mongodb',
  mongo: 'mongodb',
  rediss: 'redis',
  valkey: 'redis',
};

const DEFAULT_PORTS: Partial<Record<DbScheme, number>> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
  mongodb: 27017,
  redis: 6379,
  surrealdb: 8000,
};

/**
 * The scheme spelling each driver library actually accepts.
 *
 * This is not simply the normalised `DbScheme`: `rediss` and `mongodb+srv` carry
 * meaning that must survive. Collapsing `rediss://` to `redis://` would silently
 * turn TLS off, and dropping `+srv` would turn an Atlas SRV lookup into a direct
 * connection to a host that does not answer.
 */
const CANONICAL_SCHEMES: Partial<Record<DbScheme, (original: string) => string>> = {
  redis: (original) => (original === 'rediss' ? 'rediss' : 'redis'),
  mongodb: (original) => (original === 'mongodb+srv' ? 'mongodb+srv' : 'mongodb'),
  postgres: () => 'postgres',
};

function canonicalise(raw: string, original: string, scheme: DbScheme): string {
  const resolver = CANONICAL_SCHEMES[scheme];
  if (!resolver) {
    return raw;
  }
  const canonicalScheme = resolver(original);
  return `${canonicalScheme}:${raw.slice(original.length + 1)}`;
}

/** Query parameter names whose values are secrets. */
const SECRET_PARAMS = ['authtoken', 'token', 'password', 'apikey', 'api_key'];

export interface ParsedDsn {
  scheme: DbScheme;
  /** The original string, credentials intact. Never log this. */
  raw: string;
  /**
   * `raw` with the scheme rewritten to the exact spelling the driver library
   * expects. Drivers must pass this, not `raw` — the client libraries reject
   * aliases we advertise (`mongo://`, `valkey://`) and are case-sensitive.
   */
  canonical: string;
  /** Same string with credentials masked. Safe to log and to send to the UI. */
  redacted: string;
  remote: boolean;
  /** File-based schemes only. */
  path?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  /** SurrealDB only. */
  namespace?: string;
  /** SurrealDB only — the http(s) endpoint derived from the connection string. */
  endpoint?: string;
  /** Cloud SQL only — the `project:region:instance` connection name. */
  instance?: string;
  /** DynamoDB only — the AWS region and table name. */
  region?: string;
  table?: string;
  /** Cloudflare D1 only. */
  accountId?: string;
  databaseId?: string;
  /** Firestore only — the GCP project. */
  project?: string;
  params: Record<string, string>;
}

function splitScheme(input: string): { scheme: string; rest: string } | undefined {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(input);
  if (!match) {
    return undefined;
  }
  return { scheme: match[1]!.toLowerCase(), rest: match[2]! };
}

function normalizeScheme(scheme: string): DbScheme {
  const resolved = SCHEME_ALIASES[scheme] ?? (scheme as DbScheme);
  if (!SUPPORTED_SCHEMES.includes(resolved)) {
    throw new InvalidDsnError(
      `Unsupported database scheme "${scheme}". ` +
        `Supported schemes: ${SUPPORTED_SCHEMES.join(', ')}.`,
    );
  }
  return resolved;
}

function parseFileDsn(scheme: DbScheme, rest: string, raw: string): ParsedDsn {
  // `memory://` is process-local and ephemeral. Anything after the scheme names
  // an independent store, so `memory://scratch` and `memory://` do not collide.
  if (scheme === 'memory') {
    const name = (rest.startsWith('//') ? rest.slice(2) : rest) || 'default';
    return { scheme, raw, canonical: raw, redacted: raw, remote: false, path: name, params: {} };
  }
  // `sqlite::memory:` — the rest is the literal `:memory:` marker.
  if (rest === ':memory:') {
    return { scheme, raw, canonical: raw, redacted: raw, remote: false, path: ':memory:', params: {} };
  }
  // `json:///abs/path` → `//` authority prefix, empty host, path follows.
  const path = rest.startsWith('//') ? rest.slice(2) : rest;
  if (!path) {
    throw new InvalidDsnError(
      `${scheme} connection string is missing a file path (e.g. ${scheme}:///path/to/store).`,
    );
  }
  return { scheme, raw, canonical: raw, redacted: raw, remote: false, path, params: {} };
}

function collectParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/**
 * Google Cloud SQL: `cloudsql://user:password@PROJECT:REGION:INSTANCE/DATABASE`.
 *
 * Parsed by hand rather than with `URL`, because a Cloud SQL instance connection
 * name contains colons and the WHATWG parser would read the first one as a port
 * separator.
 */
function parseCloudSqlDsn(raw: string): ParsedDsn {
  const match =
    /^cloudsql:\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([^/?#]+)\/([^/?#]+)(\?.*)?$/.exec(raw);
  if (!match) {
    throw new InvalidDsnError(
      'Cloud SQL connection string must look like ' +
        'cloudsql://user:password@project:region:instance/database.',
    );
  }
  const [, username, password, instance, database, query] = match;

  if ((instance!.match(/:/g) ?? []).length !== 2) {
    throw new InvalidDsnError(
      `Cloud SQL instance "${instance}" must be a full connection name ` +
        'in the form project:region:instance.',
    );
  }

  const params: Record<string, string> = {};
  if (query) {
    new URLSearchParams(query.slice(1)).forEach((value, key) => {
      params[key] = value;
    });
  }

  const parsed: ParsedDsn = {
    scheme: 'cloudsql',
    raw,
    canonical: raw,
    redacted: redactDsn(raw),
    remote: true,
    instance: instance!,
    database: decodeURIComponent(database!),
    params,
  };
  if (username) {
    parsed.username = decodeURIComponent(username);
  }
  if (password) {
    parsed.password = decodeURIComponent(password);
  }
  return parsed;
}

function parseNetworkDsn(scheme: DbScheme, raw: string, original: string): ParsedDsn {
  let url: URL;
  try {
    // Swap in a neutral scheme so the WHATWG parser applies generic rules
    // consistently rather than protocol-specific ones.
    url = new URL(raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, 'http:'));
  } catch {
    throw new InvalidDsnError(`Could not parse ${scheme} connection string.`);
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const parsed: ParsedDsn = {
    scheme,
    raw,
    canonical: canonicalise(raw, original, scheme),
    redacted: redactDsn(raw),
    remote: true,
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : DEFAULT_PORTS[scheme],
    params: collectParams(url),
  };

  if (url.username) {
    parsed.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    parsed.password = decodeURIComponent(url.password);
  }

  if (scheme === 'surrealdb') {
    if (segments.length < 2) {
      throw new InvalidDsnError(
        'SurrealDB connection string needs both a namespace and a database ' +
          '(e.g. surrealdb://user:pass@host:8000/namespace/database).',
      );
    }
    parsed.namespace = decodeURIComponent(segments[0]!);
    parsed.database = decodeURIComponent(segments[1]!);
    const secure = raw.startsWith('wss:') || raw.startsWith('https:');
    const authority = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    parsed.endpoint = `${secure ? 'https' : 'http'}://${authority}`;
    return parsed;
  }

  if (scheme === 'd1') {
    // `d1://ACCOUNT_ID/DATABASE_ID?apiToken=…`
    if (!url.hostname || segments.length < 1) {
      throw new InvalidDsnError(
        'Cloudflare D1 connection string needs an account id and a database id ' +
          '(e.g. d1://ACCOUNT_ID/DATABASE_ID?apiToken=…).',
      );
    }
    parsed.accountId = url.hostname;
    parsed.databaseId = decodeURIComponent(segments[0]!);
    delete parsed.port;
    return parsed;
  }

  if (scheme === 'firestore') {
    if (!url.hostname) {
      throw new InvalidDsnError(
        'Firestore connection string needs a project id (e.g. firestore://my-project).',
      );
    }
    parsed.project = url.hostname;
    parsed.database = segments[0] ? decodeURIComponent(segments[0]) : '(default)';
    delete parsed.port;
    return parsed;
  }

  if (scheme === 'mongodb') {
    // A database segment is optional; Mongo falls back to a default below.
    parsed.database = segments[0] ? decodeURIComponent(segments[0]) : 'opencontext';
    return parsed;
  }

  if (scheme === 'redis') {
    // Redis addresses a numbered database, not a named one.
    parsed.database = segments[0] ? decodeURIComponent(segments[0]) : '0';
    return parsed;
  }

  if (scheme === 'dynamodb') {
    // The host slot carries the AWS region; the first path segment the table.
    if (!url.hostname || segments.length < 1) {
      throw new InvalidDsnError(
        'DynamoDB connection string needs a region and a table name ' +
          '(e.g. dynamodb://us-east-1/opencontext).',
      );
    }
    parsed.region = url.hostname;
    parsed.table = decodeURIComponent(segments[0]!);
    delete parsed.port;
    return parsed;
  }

  if (scheme === 'postgres' || scheme === 'mssql' || scheme === 'mysql') {
    if (segments.length < 1) {
      const examples: Record<string, string> = {
        postgres: 'postgres://user:pass@host:5432/opencontext',
        mysql: 'mysql://user:pass@host:3306/opencontext',
        mssql: 'mssql://user:pass@server.database.windows.net:1433/opencontext',
      };
      const example = examples[scheme]!;
      throw new InvalidDsnError(
        `${scheme} connection string needs a database name (e.g. ${example}).`,
      );
    }
    parsed.database = decodeURIComponent(segments[0]!);
    return parsed;
  }

  // libsql addresses a whole database by host; a path segment is optional.
  if (segments.length > 0) {
    parsed.database = decodeURIComponent(segments[0]!);
  }
  return parsed;
}

/**
 * Parse a connection string into its parts.
 *
 * A string with no recognised scheme is treated as a JSON file path, which keeps
 * the legacy `OPENCONTEXT_STORE_PATH` value working unchanged.
 */
export function parseDsn(input: string): ParsedDsn {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new InvalidDsnError('Connection string is empty.');
  }

  const split = splitScheme(trimmed);

  // No scheme, or a bare Windows drive letter — treat it as a file path.
  if (!split || split.scheme.length === 1) {
    return {
      scheme: 'json', raw: trimmed, canonical: trimmed, redacted: trimmed,
      remote: false, path: trimmed, params: {},
    };
  }

  const scheme = normalizeScheme(split.scheme);
  if (scheme === 'cloudsql') {
    return parseCloudSqlDsn(trimmed);
  }
  return FILE_SCHEMES.has(scheme)
    ? parseFileDsn(scheme, split.rest, trimmed)
    : parseNetworkDsn(scheme, trimmed, split.scheme);
}

/**
 * Mask every credential in a connection string. Applied to anything that reaches
 * a log line, an API response, or the UI.
 *
 * Input that cannot be parsed is returned unchanged — this is a display helper
 * and must never be the thing that throws.
 */
export function redactDsn(input: string): string {
  const trimmed = input.trim();
  const split = splitScheme(trimmed);
  if (!split || split.rest.startsWith(':') || !split.rest.startsWith('//')) {
    return input;
  }

  let redacted = trimmed;

  // user:password@host → user:***@host
  redacted = redacted.replace(
    /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#@]*?:)[^/?#@]*(@)/,
    '$1***$2',
  );

  // ?authToken=secret → ?authToken=***
  const queryStart = redacted.indexOf('?');
  if (queryStart !== -1) {
    const query = redacted
      .slice(queryStart + 1)
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq === -1) {
          return pair;
        }
        const key = pair.slice(0, eq);
        return SECRET_PARAMS.includes(key.toLowerCase()) ? `${key}=***` : pair;
      })
      .join('&');
    redacted = `${redacted.slice(0, queryStart)}?${query}`;
  }

  return redacted;
}

import type { Collection, Document, DocumentDriver } from '../adapters/document.js';
import type { ParsedDsn } from '../dsn.js';
import { InvalidDsnError } from '../types.js';
import { importOptional } from './optional.js';

const KEYS: Record<Collection, string> = {
  contexts: 'opencontext:contexts',
  bubbles: 'opencontext:bubbles',
};

interface RedisClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  on(event: string, listener: (...args: never[]) => void): unknown;
  connect(): Promise<unknown>;
  ping(): Promise<string>;
  /** node-redis v5+. Older releases only have `quit`. */
  close?: () => Promise<unknown>;
  quit(): Promise<unknown>;
  /** node-redis v5+. Older releases call the same thing `disconnect`. */
  destroy?: () => void;
  disconnect?: () => Promise<unknown>;
  hGet(key: string, field: string): Promise<string | null | undefined>;
  hSet(key: string, field: string, value: string): Promise<number>;
  hDel(key: string, field: string): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
}

/**
 * Rewrite the connection string into something node-redis will accept.
 *
 * node-redis parses the URL itself and rejects any scheme other than `redis:`
 * and `rediss:` with a bare `TypeError: Invalid protocol`. `valkey://` is an
 * alias opencontext advertises, so the scheme is swapped out here rather than
 * leaking a driver-internal error to someone who typed a documented URL. TLS
 * stays on only for `rediss://`; everything else connects in the clear.
 */
function clientUrl(dsn: ParsedDsn): string {
  // Every other network backend here names its database; Redis numbers them,
  // and node-redis answers a name with a bare `TypeError: Invalid pathname`.
  if (dsn.database !== undefined && !/^\d+$/.test(dsn.database)) {
    throw new InvalidDsnError(
      `Redis addresses a numbered database, so "${dsn.database}" is not a valid ` +
        'database (e.g. redis://HOST:6379/0).',
    );
  }
  const secure = /^rediss:/i.test(dsn.raw);
  return dsn.raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, secure ? 'rediss:' : 'redis:');
}

/**
 * Values are JSON strings, and a hash field can hold anything — including
 * something another program wrote. Report which field is bad rather than
 * letting a bare `SyntaxError` out of `listContexts`, where it would look like
 * an opencontext failure and give no hint what to delete.
 */
function parseDocument(collection: Collection, id: string, raw: string): Document {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Redis hash field ${KEYS[collection]}[${id}] does not contain valid JSON. ` +
        'Delete that field, or point opencontext at a database it owns.',
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Redis hash field ${KEYS[collection]}[${id}] does not contain a JSON object.`,
    );
  }
  return parsed as Document;
}

/** How many times to retry before deciding the store was never reachable. */
const CONNECT_ATTEMPTS = 3;

/**
 * Redis, and anything speaking its protocol — Valkey, Upstash, ElastiCache.
 *
 * Each collection is one hash keyed by id, so reads and writes are O(1) and
 * listing a collection is a single `HGETALL`. Values are JSON strings, which
 * keeps this working on a stock Redis with no modules installed.
 *
 * `HGETALL` is O(N) over the collection and reads it in one shot. That matches
 * what the shared document adapter needs — every search reads the whole
 * collection anyway — and it buys an atomic snapshot that `HSCAN` cannot give,
 * since a scan can return the same field twice while writes are in flight. The
 * cost is that a very large store blocks the server for the length of the call;
 * a SQL backend is the better choice at that size.
 */
export async function createRedisDriver(dsn: ParsedDsn): Promise<DocumentDriver> {
  // Checked before the driver is loaded, so a bad URL is reported as a bad URL
  // rather than as a missing npm package.
  const url = clientUrl(dsn);

  const { createClient } = await importOptional<{
    createClient: (config: Record<string, unknown>) => RedisClient;
  }>('redis', 'redis');

  /** True once the socket has been usable at least once. */
  let everReady = false;

  const client = createClient({
    url,
    socket: {
      reconnectStrategy(retries: number): number | false {
        // node-redis retries the *first* connection forever by default, so a
        // typo in the host or a Redis that is not running would hang
        // `createStore` rather than fail it. Nothing about a URL that has never
        // worked gets better by waiting, so give up and report the cause.
        if (!everReady && retries >= CONNECT_ATTEMPTS) {
          return false;
        }
        // Once it has worked, keep reconnecting — a restart or a failover is
        // exactly the case a long-lived MCP or HTTP server has to ride out.
        // Exponential backoff with jitter, matching node-redis' own default.
        return Math.min(2 ** retries * 50, 2000) + Math.floor(Math.random() * 200);
      },
    },
  });

  // node-redis emits `error` for every socket failure and reconnect attempt. An
  // EventEmitter with no `error` listener throws, which would take down the
  // whole host process — the MCP server, the HTTP server — the moment Redis
  // blinks. Hold the last one instead, so `ping` can report why the store is
  // unhealthy while the client reconnects underneath.
  let lastSocketError: Error | undefined;
  client.on('error', (error: Error) => {
    lastSocketError = error;
  });
  client.on('ready', () => {
    everReady = true;
    lastSocketError = undefined;
  });

  /** Set once the caller has closed the store, so shutdown stays idempotent. */
  let closed = false;

  /**
   * Drop the client without waiting for the server to answer.
   *
   * A client left half-open keeps a socket and a reconnect timer, and those keep
   * the whole process alive long after the caller has finished with the store.
   */
  function abandon(): void {
    try {
      if (client.destroy) {
        client.destroy();
      } else {
        // What node-redis called the same thing before v5.
        void client.disconnect?.().catch(() => {});
      }
    } catch {
      // Already gone.
    }
  }

  async function shutdown(): Promise<void> {
    try {
      // `quit` is deprecated in favour of `close` from node-redis v5 on; both
      // wait for in-flight commands.
      await (client.close ? client.close() : client.quit());
    } catch {
      // The socket was already gone, so there was nobody to answer QUIT. A
      // shutdown path must not throw, so tear the client down instead.
      abandon();
    }
  }

  return {
    async connect() {
      if (client.isOpen) {
        return;
      }
      try {
        await client.connect();
      } catch (error) {
        // A connect that never succeeded can still leave a socket and a retry
        // timer behind. Tear them down before reporting the failure.
        abandon();
        closed = true;
        throw error;
      }
    },

    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await shutdown();
    },

    async ping() {
      // A command issued while the socket is down sits in the offline queue
      // until the reconnect succeeds. That is right for writes and wrong for a
      // health check, which is being asked whether the store is reachable now.
      if (!client.isReady) {
        throw lastSocketError ?? new Error('Redis connection is not ready.');
      }
      await client.ping();
    },

    async get(collection, id) {
      const raw = await client.hGet(KEYS[collection], id);
      return raw === null || raw === undefined
        ? undefined
        : parseDocument(collection, id, raw);
    },

    async put(collection, id, document) {
      await client.hSet(KEYS[collection], id, JSON.stringify(document));
    },

    async remove(collection, id) {
      await client.hDel(KEYS[collection], id);
    },

    async list(collection) {
      const fields = await client.hGetAll(KEYS[collection]);
      return Object.entries(fields).map(([id, raw]) => parseDocument(collection, id, raw));
    },
  };
}

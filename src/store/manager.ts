import type { ContextStoreAdapter, AdapterInfo } from './types.js';
import { createStore } from './index.js';
import { resolveDatabase, writeDatabaseUrl, type ResolvedDatabase } from './config.js';

export interface StoreManager {
  /** The live adapter, connecting on first use. */
  get(): Promise<ContextStoreAdapter>;
  /** Where the current connection string came from. */
  resolution(): ResolvedDatabase;
  /** Swap to a different backend, keeping the old one if the new one fails. */
  reconnect(url: string, options?: { persist?: boolean }): Promise<AdapterInfo>;
  close(): Promise<void>;
}

/**
 * Owns the live store connection.
 *
 * Connection is lazy rather than eager so that importing `server.ts` stays
 * synchronous — the test suite imports the Express app directly, and a top-level
 * await there would change module semantics for every existing test.
 */
export function createStoreManager(): StoreManager {
  let resolved = resolveDatabase();
  let adapter: ContextStoreAdapter | undefined;
  let opening: Promise<ContextStoreAdapter> | undefined;

  async function open(url: string): Promise<ContextStoreAdapter> {
    return createStore(url);
  }

  return {
    async get() {
      if (adapter) {
        return adapter;
      }
      // Collapse concurrent first-use into one connect rather than racing.
      if (!opening) {
        opening = open(resolved.url)
          .then((opened) => {
            adapter = opened;
            return opened;
          })
          .finally(() => {
            opening = undefined;
          });
      }
      return opening;
    },

    resolution() {
      return resolved;
    },

    async reconnect(url, options = {}) {
      // Open the replacement *before* touching the current one, so a bad
      // connection string typed into the settings page cannot take the store
      // down — it fails, the old connection keeps serving, and the error is
      // returned to the caller.
      const next = await open(url);

      const previous = adapter;
      adapter = next;
      resolved = { url, redacted: next.info.target, source: 'config-file', locked: false };

      if (options.persist) {
        writeDatabaseUrl(url);
      }
      if (previous) {
        await previous.close().catch(() => undefined);
      }
      return next.info;
    },

    async close() {
      const current = adapter;
      adapter = undefined;
      await current?.close();
    },
  };
}

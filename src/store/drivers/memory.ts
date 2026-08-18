import type { Collection, Document, DocumentDriver } from '../adapters/document.js';

type Tables = Record<Collection, Map<string, Document>>;

/**
 * Stores live for the lifetime of the process, keyed by name.
 *
 * Without this, reopening `memory://` would hand back an empty store and the
 * HTTP server would appear to lose data every time it reconnected. Ephemeral
 * means "gone when the process exits", not "gone when you look away".
 */
const stores = new Map<string, Tables>();

function tablesFor(name: string): Tables {
  let tables = stores.get(name);
  if (!tables) {
    tables = { contexts: new Map(), bubbles: new Map() };
    stores.set(name, tables);
  }
  return tables;
}

/** Drop a named store. Used by tests to get a clean slate. */
export function resetMemoryStore(name = 'default'): void {
  stores.delete(name);
}

/**
 * Process-local, ephemeral storage.
 *
 * Useful for trying opencontext out without writing anything to disk, and it
 * doubles as the reference implementation of `DocumentDriver` — the shared
 * document adapter is conformance-tested through it.
 */
export function createMemoryDriver(name = 'default'): DocumentDriver {
  const tables = tablesFor(name);

  return {
    async connect() {},
    async close() {},
    async ping() {},

    async get(collection, id) {
      const found = tables[collection].get(id);
      return found ? { ...found } : undefined;
    },

    async put(collection, id, document) {
      tables[collection].set(id, { ...document });
    },

    async remove(collection, id) {
      tables[collection].delete(id);
    },

    async list(collection) {
      return [...tables[collection].values()].map((document) => ({ ...document }));
    },
  };
}

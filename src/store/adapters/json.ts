import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import type {
  ContextStoreAdapter,
  AdapterInfo,
  ContextEntry,
  Bubble,
} from '../types.js';
import type { ParsedDsn } from '../dsn.js';

const STORE_VERSION = 1;

interface JsonStoreFile {
  version: number;
  entries: ContextEntry[];
  bubbles: Bubble[];
}

/** The documented ordering contract: createdAt ascending, then id ascending. */
function byCreatedThenId<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * The original file-backed store, now behind the adapter interface.
 *
 * Reads and writes the whole document per operation, exactly as before. That is
 * fine for the default single-user case and is precisely the limitation the SQL
 * adapters exist to escape.
 */
export function createJsonAdapter(dsn: ParsedDsn): ContextStoreAdapter {
  const filePath = dsn.path!;

  const info: AdapterInfo = {
    scheme: 'json',
    label: 'JSON file',
    target: filePath,
    remote: false,
  };

  function load(): JsonStoreFile {
    if (!existsSync(filePath)) {
      return { version: STORE_VERSION, entries: [], bubbles: [] };
    }
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as JsonStoreFile;
    // Migrate stores that predate the bubbles field
    if (!parsed.bubbles) {
      parsed.bubbles = [];
    }
    if (!parsed.entries) {
      parsed.entries = [];
    }
    return parsed;
  }

  function save(store: JsonStoreFile): void {
    const directory = dirname(filePath);
    if (directory && !existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  function sortedEntries(store: JsonStoreFile): ContextEntry[] {
    return [...store.entries].sort(byCreatedThenId);
  }

  return {
    info,

    async connect() {
      const directory = dirname(filePath);
      if (directory && !existsSync(directory)) {
        mkdirSync(directory, { recursive: true });
      }
    },

    async close() {
      // Nothing to release — every operation opens and closes the file itself.
    },

    async ping() {
      load();
    },

    // -----------------------------------------------------------------------
    // Contexts
    // -----------------------------------------------------------------------

    async saveContext(content, tags = [], source = 'chat', bubbleId) {
      const store = load();
      const now = new Date().toISOString();
      const entry: ContextEntry = {
        id: randomUUID(),
        content,
        tags,
        source,
        createdAt: now,
        updatedAt: now,
      };
      if (bubbleId !== undefined) {
        entry.bubbleId = bubbleId;
      }
      store.entries.push(entry);
      save(store);
      return entry;
    },

    async recallContext(query) {
      const lower = query.toLowerCase();
      return sortedEntries(load()).filter(
        (entry) =>
          entry.content.toLowerCase().includes(lower) ||
          entry.tags.some((tag) => tag.toLowerCase().includes(lower)),
      );
    },

    async listContexts(tag) {
      const entries = sortedEntries(load());
      if (!tag) {
        return entries;
      }
      const lowerTag = tag.toLowerCase();
      return entries.filter((entry) => entry.tags.some((t) => t.toLowerCase() === lowerTag));
    },

    async listContextsByBubble(bubbleId) {
      return sortedEntries(load()).filter((entry) => entry.bubbleId === bubbleId);
    },

    async getContext(id) {
      return load().entries.find((entry) => entry.id === id);
    },

    async updateContext(id, content, tags, bubbleId) {
      const store = load();
      const entry = store.entries.find((e) => e.id === id);
      if (!entry) {
        return undefined;
      }
      entry.content = content;
      if (tags !== undefined) {
        entry.tags = tags;
      }
      if (bubbleId !== undefined) {
        if (bubbleId === null) {
          delete entry.bubbleId;
        } else {
          entry.bubbleId = bubbleId;
        }
      }
      entry.updatedAt = new Date().toISOString();
      save(store);
      return entry;
    },

    async deleteContext(id) {
      const store = load();
      const before = store.entries.length;
      store.entries = store.entries.filter((entry) => entry.id !== id);
      if (store.entries.length === before) {
        return false;
      }
      save(store);
      return true;
    },

    async searchContexts(query) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      return sortedEntries(load()).filter((entry) => {
        const haystack =
          `${entry.content} ${entry.tags.join(' ')} ${entry.source}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    },

    // -----------------------------------------------------------------------
    // Bubbles
    // -----------------------------------------------------------------------

    async createBubble(name, description) {
      const store = load();
      const now = new Date().toISOString();
      const bubble: Bubble = { id: randomUUID(), name, createdAt: now, updatedAt: now };
      if (description !== undefined) {
        bubble.description = description;
      }
      store.bubbles.push(bubble);
      save(store);
      return bubble;
    },

    async listBubbles() {
      return [...load().bubbles].sort(byCreatedThenId);
    },

    async getBubble(id) {
      return load().bubbles.find((bubble) => bubble.id === id);
    },

    async updateBubble(id, name, description) {
      const store = load();
      const bubble = store.bubbles.find((b) => b.id === id);
      if (!bubble) {
        return undefined;
      }
      bubble.name = name;
      if (description !== undefined) {
        bubble.description = description;
      }
      bubble.updatedAt = new Date().toISOString();
      save(store);
      return bubble;
    },

    async deleteBubble(id, deleteContexts = false) {
      const store = load();
      const before = store.bubbles.length;
      store.bubbles = store.bubbles.filter((bubble) => bubble.id !== id);
      if (store.bubbles.length === before) {
        return false;
      }
      if (deleteContexts) {
        store.entries = store.entries.filter((entry) => entry.bubbleId !== id);
      } else {
        store.entries.forEach((entry) => {
          if (entry.bubbleId === id) {
            delete entry.bubbleId;
          }
        });
      }
      save(store);
      return true;
    },
  };
}

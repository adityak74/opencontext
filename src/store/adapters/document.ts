import { randomUUID } from 'crypto';
import type {
  ContextStoreAdapter,
  AdapterInfo,
  ContextEntry,
  Bubble,
} from '../types.js';

export type Collection = 'contexts' | 'bubbles';

export type Document = Record<string, unknown>;

/**
 * The minimum a document or key-value store must provide.
 *
 * Everything else — search, tag filtering, ordering, bubble cascade — is
 * implemented once in `createDocumentAdapter`, so adding a new NoSQL backend
 * means writing six small methods rather than the whole storage contract.
 */
export interface DocumentDriver {
  connect(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<void>;
  get(collection: Collection, id: string): Promise<Document | undefined>;
  put(collection: Collection, id: string, document: Document): Promise<void>;
  remove(collection: Collection, id: string): Promise<void>;
  list(collection: Collection): Promise<Document[]>;
}

function byCreatedThenId<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function toEntry(document: Document): ContextEntry {
  const entry: ContextEntry = {
    id: document.id as string,
    content: document.content as string,
    tags: (document.tags as string[]) ?? [],
    source: document.source as string,
    createdAt: document.createdAt as string,
    updatedAt: document.updatedAt as string,
  };
  if (document.bubbleId !== undefined && document.bubbleId !== null) {
    entry.bubbleId = document.bubbleId as string;
  }
  return entry;
}

function toBubble(document: Document): Bubble {
  const bubble: Bubble = {
    id: document.id as string,
    name: document.name as string,
    createdAt: document.createdAt as string,
    updatedAt: document.updatedAt as string,
  };
  if (document.description !== undefined && document.description !== null) {
    bubble.description = document.description as string;
  }
  return bubble;
}

/**
 * The storage contract over any document or key-value store.
 *
 * Predicates are evaluated in memory rather than pushed down, because the
 * backends behind this interface either cannot express case-insensitive
 * substring search at all (DynamoDB, Redis) or express it in mutually
 * incompatible ways (Mongo regex, Firestore's lack of one). Evaluating in one
 * place keeps search semantics byte-identical to the SQL and JSON adapters,
 * which is what makes the shared conformance suite meaningful.
 *
 * The cost is real: search reads the whole context collection. For a store large
 * enough for that to hurt, a SQL backend is the better choice, and the README
 * says so.
 */
export function createDocumentAdapter(
  driver: DocumentDriver,
  info: AdapterInfo,
): ContextStoreAdapter {
  async function allEntries(): Promise<ContextEntry[]> {
    const documents = await driver.list('contexts');
    return documents.map(toEntry).sort(byCreatedThenId);
  }

  return {
    info,

    connect: () => driver.connect(),
    close: () => driver.close(),
    ping: () => driver.ping(),

    // -----------------------------------------------------------------------
    // Contexts
    // -----------------------------------------------------------------------

    async saveContext(content, tags = [], source = 'chat', bubbleId) {
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
      await driver.put('contexts', entry.id, { ...entry });
      return entry;
    },

    async recallContext(query) {
      const needle = query.toLowerCase();
      return (await allEntries()).filter(
        (entry) =>
          entry.content.toLowerCase().includes(needle) ||
          entry.tags.some((tag) => tag.toLowerCase().includes(needle)),
      );
    },

    async listContexts(tag) {
      const entries = await allEntries();
      if (!tag) {
        return entries;
      }
      const lower = tag.toLowerCase();
      return entries.filter((entry) => entry.tags.some((t) => t.toLowerCase() === lower));
    },

    async listContextsByBubble(bubbleId) {
      return (await allEntries()).filter((entry) => entry.bubbleId === bubbleId);
    },

    async getContext(id) {
      const document = await driver.get('contexts', id);
      return document ? toEntry(document) : undefined;
    },

    async updateContext(id, content, tags, bubbleId) {
      const existing = await driver.get('contexts', id);
      if (!existing) {
        return undefined;
      }
      const entry = toEntry(existing);
      entry.content = content;
      if (tags !== undefined) {
        entry.tags = tags;
      }
      if (bubbleId === null) {
        delete entry.bubbleId;
      } else if (bubbleId !== undefined) {
        entry.bubbleId = bubbleId;
      }
      entry.updatedAt = new Date().toISOString();
      await driver.put('contexts', id, { ...entry });
      return entry;
    },

    async deleteContext(id) {
      if (!(await driver.get('contexts', id))) {
        return false;
      }
      await driver.remove('contexts', id);
      return true;
    },

    async searchContexts(query) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const entries = await allEntries();
      if (terms.length === 0) {
        return entries;
      }
      return entries.filter((entry) => {
        const haystack =
          `${entry.content} ${entry.tags.join(' ')} ${entry.source}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    },

    // -----------------------------------------------------------------------
    // Bubbles
    // -----------------------------------------------------------------------

    async createBubble(name, description) {
      const now = new Date().toISOString();
      const bubble: Bubble = { id: randomUUID(), name, createdAt: now, updatedAt: now };
      if (description !== undefined) {
        bubble.description = description;
      }
      await driver.put('bubbles', bubble.id, { ...bubble });
      return bubble;
    },

    async listBubbles() {
      const documents = await driver.list('bubbles');
      return documents.map(toBubble).sort(byCreatedThenId);
    },

    async getBubble(id) {
      const document = await driver.get('bubbles', id);
      return document ? toBubble(document) : undefined;
    },

    async updateBubble(id, name, description) {
      const existing = await driver.get('bubbles', id);
      if (!existing) {
        return undefined;
      }
      const bubble = toBubble(existing);
      bubble.name = name;
      if (description !== undefined) {
        bubble.description = description;
      }
      bubble.updatedAt = new Date().toISOString();
      await driver.put('bubbles', id, { ...bubble });
      return bubble;
    },

    async deleteBubble(id, deleteContexts = false) {
      if (!(await driver.get('bubbles', id))) {
        return false;
      }
      await driver.remove('bubbles', id);

      const affected = (await allEntries()).filter((entry) => entry.bubbleId === id);
      for (const entry of affected) {
        if (deleteContexts) {
          await driver.remove('contexts', entry.id);
        } else {
          delete entry.bubbleId;
          await driver.put('contexts', entry.id, { ...entry });
        }
      }
      return true;
    },
  };
}

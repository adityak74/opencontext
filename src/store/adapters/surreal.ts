import { randomUUID } from 'crypto';
import {
  type ContextStoreAdapter,
  type AdapterInfo,
  type ContextEntry,
  type Bubble,
  InvalidDsnError,
} from '../types.js';
import type { ParsedDsn } from '../dsn.js';
import { importOptional } from '../drivers/optional.js';

interface SurrealClient {
  connect(endpoint: string, options: Record<string, unknown>): Promise<unknown>;
  query<T = unknown>(sql: string, vars?: Record<string, unknown>): Promise<T[]>;
  close(): Promise<void>;
}

interface ContextRecord {
  uid: string;
  content: string;
  tags: string[];
  source: string;
  bubble_uid: string | null;
  created_at: string;
  updated_at: string;
}

interface BubbleRecord {
  uid: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

const CONTEXT_TABLE = 'oc_context';
const BUBBLE_TABLE = 'oc_bubble';
const ORDER = 'ORDER BY created_at ASC, uid ASC';

/** Quote a namespace/database name — DEFINE statements cannot take bind variables. */
function ident(name: string): string {
  return '`' + name.replace(/`/g, '\\`') + '`';
}

/**
 * Build the sign-in payload for the connection string's credentials.
 *
 * SurrealDB users are scoped, and the payload has to name the scope: a root user
 * signs in with only a username and password, a namespace or database user must
 * also say which namespace and database it belongs to. Sending the wrong shape
 * fails as a flat "There was a problem with authentication", and nothing in the
 * connection string distinguishes the two, so `?auth=` selects the level.
 */
function authFor(dsn: ParsedDsn): Record<string, unknown> | undefined {
  if (!dsn.username) {
    return undefined;
  }
  const credentials = { username: dsn.username, password: dsn.password ?? '' };
  const level = (dsn.params.auth ?? 'root').toLowerCase();

  if (level === 'root') {
    return credentials;
  }
  if (level === 'namespace' || level === 'ns') {
    return { namespace: dsn.namespace, ...credentials };
  }
  if (level === 'database' || level === 'db') {
    return { namespace: dsn.namespace, database: dsn.database, ...credentials };
  }
  throw new InvalidDsnError(
    `Unsupported SurrealDB auth level "${dsn.params.auth}". ` +
      'Use auth=root (the default), auth=namespace or auth=database.',
  );
}

/**
 * Denormalised lowercase fields.
 *
 * SurrealQL can lowercase on read, but doing it on write keeps every predicate a
 * plain `string::contains` and avoids per-version differences in closure syntax.
 *
 * Every read still coalesces these with `?? ''`, because a row written by
 * anything other than this adapter will not have them, and passing NONE to
 * `string::contains` fails the whole query rather than skipping the row.
 */
function searchFields(content: string, tags: string[], source: string) {
  return {
    tags_lower: tags.map((tag) => tag.toLowerCase()),
    tags_text: tags.join(' ').toLowerCase(),
    search_text: `${content} ${tags.join(' ')} ${source}`.toLowerCase(),
  };
}

function toEntry(record: ContextRecord): ContextEntry {
  const entry: ContextEntry = {
    id: record.uid,
    content: record.content,
    tags: record.tags ?? [],
    source: record.source,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
  if (record.bubble_uid !== null && record.bubble_uid !== undefined) {
    entry.bubbleId = record.bubble_uid;
  }
  return entry;
}

function toBubble(record: BubbleRecord): Bubble {
  const bubble: Bubble = {
    id: record.uid,
    name: record.name,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
  if (record.description !== null && record.description !== undefined) {
    bubble.description = record.description;
  }
  return bubble;
}

/**
 * SurrealDB, embedded or remote.
 *
 * Records carry their own `uid` string rather than using opencontext ids as
 * Surreal record ids, so nothing here depends on how a given SDK version
 * serialises `RecordId`.
 */
export async function createSurrealAdapter(
  dsn: ParsedDsn,
  info: AdapterInfo,
): Promise<ContextStoreAdapter> {
  const { Surreal } = await importOptional<{ Surreal: new () => SurrealClient }>(
    'surrealdb',
    'surrealdb',
  );

  const db = new Surreal();

  /** SurrealDB returns one result block per statement; we always send one. */
  async function q<T>(sql: string, vars: Record<string, unknown> = {}): Promise<T[]> {
    const result = await db.query<T[]>(sql, vars);
    return (result[0] ?? []) as T[];
  }

  /** Run setup DDL that a correctly provisioned but unprivileged user may refuse. */
  async function bestEffort(sql: string): Promise<void> {
    try {
      await db.query(sql);
    } catch {
      // Deliberately ignored — see the call site.
    }
  }

  async function findContext(id: string): Promise<ContextRecord | undefined> {
    const rows = await q<ContextRecord>(
      `SELECT * FROM ${CONTEXT_TABLE} WHERE uid = $uid LIMIT 1`,
      { uid: id },
    );
    return rows[0];
  }

  async function findBubble(id: string): Promise<BubbleRecord | undefined> {
    const rows = await q<BubbleRecord>(
      `SELECT * FROM ${BUBBLE_TABLE} WHERE uid = $uid LIMIT 1`,
      { uid: id },
    );
    return rows[0];
  }

  return {
    info,

    async connect() {
      const options: Record<string, unknown> = {
        namespace: dsn.namespace,
        database: dsn.database,
      };
      const authentication = authFor(dsn);
      if (authentication) {
        options.authentication = authentication;
      }
      await db.connect(dsn.endpoint!, options);

      // A namespace and database are no longer created implicitly by selecting
      // them, so create them here. Only a root user may: a database-scoped user
      // is refused, and does not need it, because its database already exists.
      // Swallowing that refusal is safe — if the database really is missing, the
      // DEFINE TABLE below fails and reports it.
      await bestEffort(`DEFINE NAMESPACE IF NOT EXISTS ${ident(dsn.namespace!)}`);
      await bestEffort(`DEFINE DATABASE IF NOT EXISTS ${ident(dsn.database!)}`);

      // SELECT, UPDATE and DELETE all error on a table that was never defined,
      // so both tables have to exist before the first read, not the first write.
      await db.query(`DEFINE TABLE IF NOT EXISTS ${CONTEXT_TABLE} SCHEMALESS`);
      await db.query(`DEFINE TABLE IF NOT EXISTS ${BUBBLE_TABLE} SCHEMALESS`);

      await db.query(`DEFINE INDEX IF NOT EXISTS ${CONTEXT_TABLE}_uid
                      ON ${CONTEXT_TABLE} FIELDS uid UNIQUE`);
      await db.query(`DEFINE INDEX IF NOT EXISTS ${BUBBLE_TABLE}_uid
                      ON ${BUBBLE_TABLE} FIELDS uid UNIQUE`);
      await db.query(`DEFINE INDEX IF NOT EXISTS ${CONTEXT_TABLE}_bubble
                      ON ${CONTEXT_TABLE} FIELDS bubble_uid`);
    },

    async close() {
      await db.close();
    },

    async ping() {
      await db.query('RETURN 1');
    },

    // -----------------------------------------------------------------------
    // Contexts
    // -----------------------------------------------------------------------

    async saveContext(content, tags = [], source = 'chat', bubbleId) {
      const now = new Date().toISOString();
      const uid = randomUUID();
      await q(`CREATE ${CONTEXT_TABLE} CONTENT $data`, {
        data: {
          uid,
          content,
          tags,
          source,
          bubble_uid: bubbleId ?? null,
          created_at: now,
          updated_at: now,
          ...searchFields(content, tags, source),
        },
      });
      const entry: ContextEntry = {
        id: uid,
        content,
        tags,
        source,
        createdAt: now,
        updatedAt: now,
      };
      if (bubbleId !== undefined) {
        entry.bubbleId = bubbleId;
      }
      return entry;
    },

    async recallContext(query) {
      const needle = query.toLowerCase();
      const rows = await q<ContextRecord>(
        `SELECT * FROM ${CONTEXT_TABLE}
         WHERE string::contains(string::lowercase(content ?? ''), $needle)
            OR string::contains(tags_text ?? '', $needle)
         ${ORDER}`,
        { needle },
      );
      return rows.map(toEntry);
    },

    async listContexts(tag) {
      if (!tag) {
        return (await q<ContextRecord>(`SELECT * FROM ${CONTEXT_TABLE} ${ORDER}`)).map(toEntry);
      }
      const rows = await q<ContextRecord>(
        `SELECT * FROM ${CONTEXT_TABLE} WHERE $tag IN tags_lower ${ORDER}`,
        { tag: tag.toLowerCase() },
      );
      return rows.map(toEntry);
    },

    async listContextsByBubble(bubbleId) {
      const rows = await q<ContextRecord>(
        `SELECT * FROM ${CONTEXT_TABLE} WHERE bubble_uid = $bubble ${ORDER}`,
        { bubble: bubbleId },
      );
      return rows.map(toEntry);
    },

    async getContext(id) {
      const record = await findContext(id);
      return record ? toEntry(record) : undefined;
    },

    async updateContext(id, content, tags, bubbleId) {
      const existing = await findContext(id);
      if (!existing) {
        return undefined;
      }
      const nextTags = tags !== undefined ? tags : (existing.tags ?? []);
      const nextBubble =
        bubbleId === undefined ? existing.bubble_uid : bubbleId === null ? null : bubbleId;
      const updatedAt = new Date().toISOString();

      await q(
        `UPDATE ${CONTEXT_TABLE} MERGE $data WHERE uid = $uid`,
        {
          uid: id,
          data: {
            content,
            tags: nextTags,
            bubble_uid: nextBubble,
            updated_at: updatedAt,
            ...searchFields(content, nextTags, existing.source),
          },
        },
      );
      return toEntry({
        ...existing,
        content,
        tags: nextTags,
        bubble_uid: nextBubble,
        updated_at: updatedAt,
      });
    },

    async deleteContext(id) {
      if (!(await findContext(id))) {
        return false;
      }
      await q(`DELETE ${CONTEXT_TABLE} WHERE uid = $uid`, { uid: id });
      return true;
    },

    async searchContexts(query) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0) {
        return (await q<ContextRecord>(`SELECT * FROM ${CONTEXT_TABLE} ${ORDER}`)).map(toEntry);
      }
      const vars: Record<string, unknown> = {};
      const clauses = terms.map((term, index) => {
        vars[`t${index}`] = term;
        return `string::contains(search_text ?? '', $t${index})`;
      });
      const rows = await q<ContextRecord>(
        `SELECT * FROM ${CONTEXT_TABLE} WHERE ${clauses.join(' AND ')} ${ORDER}`,
        vars,
      );
      return rows.map(toEntry);
    },

    // -----------------------------------------------------------------------
    // Bubbles
    // -----------------------------------------------------------------------

    async createBubble(name, description) {
      const now = new Date().toISOString();
      const uid = randomUUID();
      await q(`CREATE ${BUBBLE_TABLE} CONTENT $data`, {
        data: {
          uid,
          name,
          description: description ?? null,
          created_at: now,
          updated_at: now,
        },
      });
      const bubble: Bubble = { id: uid, name, createdAt: now, updatedAt: now };
      if (description !== undefined) {
        bubble.description = description;
      }
      return bubble;
    },

    async listBubbles() {
      return (await q<BubbleRecord>(`SELECT * FROM ${BUBBLE_TABLE} ${ORDER}`)).map(toBubble);
    },

    async getBubble(id) {
      const record = await findBubble(id);
      return record ? toBubble(record) : undefined;
    },

    async updateBubble(id, name, description) {
      const existing = await findBubble(id);
      if (!existing) {
        return undefined;
      }
      const nextDescription = description !== undefined ? description : existing.description;
      const updatedAt = new Date().toISOString();
      await q(`UPDATE ${BUBBLE_TABLE} MERGE $data WHERE uid = $uid`, {
        uid: id,
        data: { name, description: nextDescription, updated_at: updatedAt },
      });
      return toBubble({ ...existing, name, description: nextDescription, updated_at: updatedAt });
    },

    async deleteBubble(id, deleteContexts = false) {
      if (!(await findBubble(id))) {
        return false;
      }
      await q(`DELETE ${BUBBLE_TABLE} WHERE uid = $uid`, { uid: id });
      if (deleteContexts) {
        await q(`DELETE ${CONTEXT_TABLE} WHERE bubble_uid = $bubble`, { bubble: id });
      } else {
        await q(`UPDATE ${CONTEXT_TABLE} SET bubble_uid = NONE WHERE bubble_uid = $bubble`, {
          bubble: id,
        });
      }
      return true;
    },
  };
}

import { randomUUID } from 'crypto';
import type {
  ContextStoreAdapter,
  AdapterInfo,
  ContextEntry,
  Bubble,
} from '../types.js';

/**
 * Everything that differs between the SQL engines.
 *
 * SQLite, Postgres and DuckDB share one set of values; SQL Server / Azure SQL
 * diverges on all four, which is why these are dialect properties rather than
 * constants.
 */
export interface Dialect {
  name: string;
  /** Render the nth (1-based) bind placeholder: `?`, `$1` or `@p1`. */
  placeholder(index: number): string;
  /** Statements that create the schema if it is not already present. */
  ddl: string[];
  /** Join column expressions into a single string: `a || b` or `a + b`. */
  concat(parts: string[]): string;
}

export interface SqlDriver {
  readonly dialect: Dialect;
  /** Run a statement with no bind parameters (DDL). */
  exec(sql: string): Promise<void>;
  /** Run a mutating statement. */
  run(sql: string, params: unknown[]): Promise<void>;
  /** Run a query and return its rows. */
  all<T>(sql: string, params: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * The portable schema, used by SQLite, Postgres and DuckDB unchanged.
 *
 * Every column is TEXT and `tags` holds a JSON-encoded string array rather than
 * a native array type, so no query below needs to branch on the engine.
 */
export const STANDARD_DDL = [
  `CREATE TABLE IF NOT EXISTS oc_bubbles (
     id          TEXT PRIMARY KEY,
     name        TEXT NOT NULL,
     description TEXT,
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS oc_contexts (
     id         TEXT PRIMARY KEY,
     content    TEXT NOT NULL,
     tags       TEXT NOT NULL,
     source     TEXT NOT NULL,
     bubble_id  TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS oc_contexts_bubble_idx ON oc_contexts (bubble_id)`,
];

/**
 * Serialise one bootstrap step across every process opening the same database.
 *
 * `IF OBJECT_ID(…) IS NULL CREATE TABLE …` is a check followed by a create, and
 * SQL Server takes incompatible metadata locks while running it. Two processes
 * opening the same fresh database therefore do not merely both try to create the
 * table — they deadlock, and SQL Server kills one of them outright.
 *
 * An application lock makes the check-and-create a single critical section that
 * spans processes, so the second connection waits and then finds the table. The
 * lock is owned by the transaction, so it is released even if the batch throws.
 */
const mssqlBootstrap = (body: string) => `
  BEGIN TRANSACTION;
  BEGIN TRY
    EXEC sp_getapplock @Resource = 'opencontext_schema', @LockMode = 'Exclusive',
                       @LockOwner = 'Transaction', @LockTimeout = 30000;
    ${body};
    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH`;

/**
 * Every other engine compares and sorts text the same way on every install; SQL
 * Server does whatever the database's collation says, and that is chosen once at
 * `CREATE DATABASE` and never mentioned again. Left to the default, the same
 * store would behave differently on two Azure servers:
 *
 * - Key columns are compared byte-for-byte, so an id matches only its own exact
 *   spelling and `ORDER BY created_at, id` is the ordinal order the contract
 *   documents. Under a default (case-insensitive) collation `getContext` would
 *   answer to the wrong casing, which no other backend does.
 * - Searched columns get a fixed, culture-neutral collation, because `LOWER()`
 *   follows the collation's language. Under a Turkish or Azerbaijani collation
 *   `LOWER(N'Istanbul')` is `ıstanbul` with a dotless i, which never matches the
 *   dotted i that JavaScript's `toLowerCase` produces — every recall, tag filter
 *   and search over content holding a capital I silently returns nothing.
 *   Accent sensitivity is pinned for the same reason: `café` must not answer to
 *   `cafe` here when it does not anywhere else.
 */
const MSSQL_KEY_COLLATE = 'COLLATE Latin1_General_BIN2';
const MSSQL_TEXT_COLLATE = 'COLLATE Latin1_General_CI_AS';

/**
 * SQL Server / Azure SQL. It has no `CREATE TABLE IF NOT EXISTS`, deprecates
 * `TEXT` in favour of `NVARCHAR(MAX)`, and cannot index an unbounded column —
 * hence the fixed width on the key columns.
 */
export const MSSQL_DDL = [
  mssqlBootstrap(`
    IF OBJECT_ID('oc_bubbles', 'U') IS NULL
      CREATE TABLE oc_bubbles (
        id          NVARCHAR(64)  ${MSSQL_KEY_COLLATE} PRIMARY KEY,
        name        NVARCHAR(MAX) ${MSSQL_TEXT_COLLATE} NOT NULL,
        description NVARCHAR(MAX) ${MSSQL_TEXT_COLLATE},
        created_at  NVARCHAR(64)  ${MSSQL_KEY_COLLATE} NOT NULL,
        updated_at  NVARCHAR(64)  ${MSSQL_KEY_COLLATE} NOT NULL
      )`),
  mssqlBootstrap(`
    IF OBJECT_ID('oc_contexts', 'U') IS NULL
      CREATE TABLE oc_contexts (
        id         NVARCHAR(64)  ${MSSQL_KEY_COLLATE} PRIMARY KEY,
        content    NVARCHAR(MAX) ${MSSQL_TEXT_COLLATE} NOT NULL,
        tags       NVARCHAR(MAX) ${MSSQL_TEXT_COLLATE} NOT NULL,
        source     NVARCHAR(MAX) ${MSSQL_TEXT_COLLATE} NOT NULL,
        bubble_id  NVARCHAR(64)  ${MSSQL_KEY_COLLATE},
        created_at NVARCHAR(64)  ${MSSQL_KEY_COLLATE} NOT NULL,
        updated_at NVARCHAR(64)  ${MSSQL_KEY_COLLATE} NOT NULL
      )`),
  mssqlBootstrap(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE name = 'oc_contexts_bubble_idx' AND object_id = OBJECT_ID('oc_contexts')
    )
      CREATE INDEX oc_contexts_bubble_idx ON oc_contexts (bubble_id)`),
];

const pipeConcat = (parts: string[]) => parts.join(" || ");

export const QUESTION_MARK_DIALECT = (name: string): Dialect => ({
  name,
  placeholder: () => '?',
  ddl: STANDARD_DDL,
  concat: pipeConcat,
});

export const NUMBERED_DIALECT = (name: string): Dialect => ({
  name,
  placeholder: (index) => `$${index}`,
  ddl: STANDARD_DDL,
  concat: pipeConcat,
});

/**
 * MySQL and MariaDB.
 *
 * `TEXT` cannot be a primary key without a prefix length, `CREATE INDEX IF NOT
 * EXISTS` is not supported (so the index is declared inline), and `||` means OR
 * rather than concatenation unless PIPES_AS_CONCAT is set.
 *
 * Every free-text column is LONGTEXT rather than TEXT because TEXT caps at 64KB
 * and MySQL in strict mode rejects — rather than truncates — anything longer, so
 * a `source` or bubble name that the other engines store happily would fail here.
 *
 * Charset and collation are pinned rather than inherited. A database created
 * with a latin1 default — still the norm on pre-8.0 servers, which is exactly
 * what "bring your own database" points at — cannot hold emoji or CJK at all,
 * and MySQL's default `utf8mb4_0900_ai_ci` is both case- and *accent*-
 * insensitive, which would make `café` match a search for `cafe` and two ids
 * differing only in case collide on the primary key. `utf8mb4_bin` compares by
 * code point, matching SQLite and Postgres; the case-insensitive matching the
 * store contract requires comes from `LOWER()` in the queries, not from the
 * collation. `utf8mb4_bin` is used in preference to `utf8mb4_0900_as_cs`
 * because MariaDB has no `_0900_` collations.
 */
export const MYSQL_DDL = [
  `CREATE TABLE IF NOT EXISTS oc_bubbles (
     id          VARCHAR(255) PRIMARY KEY,
     name        LONGTEXT NOT NULL,
     description LONGTEXT,
     created_at  VARCHAR(64) NOT NULL,
     updated_at  VARCHAR(64) NOT NULL
   ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS oc_contexts (
     id         VARCHAR(255) PRIMARY KEY,
     content    LONGTEXT NOT NULL,
     tags       LONGTEXT NOT NULL,
     source     LONGTEXT NOT NULL,
     bubble_id  VARCHAR(255),
     created_at VARCHAR(64) NOT NULL,
     updated_at VARCHAR(64) NOT NULL,
     INDEX oc_contexts_bubble_idx (bubble_id)
   ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
];

export const MYSQL_DIALECT: Dialect = {
  name: 'mysql',
  placeholder: () => '?',
  ddl: MYSQL_DDL,
  concat: (parts) => `CONCAT(${parts.join(', ')})`,
};

export const MSSQL_DIALECT: Dialect = {
  name: 'mssql',
  placeholder: (index) => `@p${index}`,
  ddl: MSSQL_DDL,
  concat: (parts) => parts.join(' + '),
};

interface ContextRow {
  id: string;
  content: string;
  tags: string;
  source: string;
  bubble_id: string | null;
  created_at: string;
  updated_at: string;
}

interface BubbleRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

const CONTEXT_COLUMNS = 'id, content, tags, source, bubble_id, created_at, updated_at';
const BUBBLE_COLUMNS = 'id, name, description, created_at, updated_at';
const CONTEXT_ORDER = 'ORDER BY created_at ASC, id ASC';

/**
 * Rewrite `?` placeholders into the dialect's own style.
 *
 * Queries below are written with `?` because it reads better; Postgres gets
 * `$1`, `$2`, … Literal `?` never appears inside our SQL strings otherwise.
 */
function bind(dialect: Dialect, sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => dialect.placeholder(++index));
}

/**
 * Escape LIKE wildcards so a user's `%` or `_` matches literally.
 *
 * `!` is the escape character rather than the more usual `\`, because MySQL
 * treats backslash as an escape inside string literals too, so `ESCAPE '\'`
 * has to be double-escaped there and nowhere else. `!` needs no quoting in any
 * of the five engines.
 */
const LIKE_ESCAPE = "ESCAPE '!'";

function likeTerm(value: string): string {
  return `%${value.toLowerCase().replace(/([!%_])/g, '!$1')}%`;
}

function rowToEntry(row: ContextRow): ContextEntry {
  const entry: ContextEntry = {
    id: row.id,
    content: row.content,
    tags: JSON.parse(row.tags) as string[],
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.bubble_id !== null && row.bubble_id !== undefined) {
    entry.bubbleId = row.bubble_id;
  }
  return entry;
}

function rowToBubble(row: BubbleRow): Bubble {
  const bubble: Bubble = {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.description !== null && row.description !== undefined) {
    bubble.description = row.description;
  }
  return bubble;
}

/**
 * The whole storage contract implemented once against `SqlDriver`.
 *
 * Existence is checked with a SELECT before every mutation rather than reading
 * an affected-row count, because the three drivers report that count in three
 * incompatible ways — and one of them not at all.
 */
export function createSqlAdapter(driver: SqlDriver, info: AdapterInfo): ContextStoreAdapter {
  const { dialect } = driver;
  const sql = (text: string) => bind(dialect, text);

  async function findContextRow(id: string): Promise<ContextRow | undefined> {
    const rows = await driver.all<ContextRow>(
      sql(`SELECT ${CONTEXT_COLUMNS} FROM oc_contexts WHERE id = ?`),
      [id],
    );
    return rows[0];
  }

  async function findBubbleRow(id: string): Promise<BubbleRow | undefined> {
    const rows = await driver.all<BubbleRow>(
      sql(`SELECT ${BUBBLE_COLUMNS} FROM oc_bubbles WHERE id = ?`),
      [id],
    );
    return rows[0];
  }

  return {
    info,

    async connect() {
      for (const statement of dialect.ddl) {
        await driver.exec(statement);
      }
    },

    async close() {
      await driver.close();
    },

    async ping() {
      await driver.all('SELECT 1', []);
    },

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
      await driver.run(
        sql(
          `INSERT INTO oc_contexts (${CONTEXT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ),
        [entry.id, content, JSON.stringify(tags), source, bubbleId ?? null, now, now],
      );
      return entry;
    },

    async recallContext(query) {
      const needle = likeTerm(query);
      const rows = await driver.all<ContextRow>(
        sql(
          `SELECT ${CONTEXT_COLUMNS} FROM oc_contexts
           WHERE LOWER(content) LIKE ? ${LIKE_ESCAPE}
              OR LOWER(tags)    LIKE ? ${LIKE_ESCAPE}
           ${CONTEXT_ORDER}`,
        ),
        [needle, needle],
      );
      return rows.map(rowToEntry);
    },

    async listContexts(tag) {
      if (!tag) {
        const rows = await driver.all<ContextRow>(
          `SELECT ${CONTEXT_COLUMNS} FROM oc_contexts ${CONTEXT_ORDER}`,
          [],
        );
        return rows.map(rowToEntry);
      }
      // Tags are a JSON array, so the surrounding quotes make this an exact
      // element match rather than a prefix match: `"work"` ≠ `"workspace"`.
      const needle = likeTerm(JSON.stringify(tag.toLowerCase()));
      const rows = await driver.all<ContextRow>(
        sql(
          `SELECT ${CONTEXT_COLUMNS} FROM oc_contexts
           WHERE LOWER(tags) LIKE ? ${LIKE_ESCAPE} ${CONTEXT_ORDER}`,
        ),
        [needle],
      );
      return rows.map(rowToEntry);
    },

    async listContextsByBubble(bubbleId) {
      const rows = await driver.all<ContextRow>(
        sql(
          `SELECT ${CONTEXT_COLUMNS} FROM oc_contexts WHERE bubble_id = ? ${CONTEXT_ORDER}`,
        ),
        [bubbleId],
      );
      return rows.map(rowToEntry);
    },

    async getContext(id) {
      const row = await findContextRow(id);
      return row ? rowToEntry(row) : undefined;
    },

    async updateContext(id, content, tags, bubbleId) {
      const existing = await findContextRow(id);
      if (!existing) {
        return undefined;
      }
      const updatedAt = new Date().toISOString();
      const nextTags = tags !== undefined ? JSON.stringify(tags) : existing.tags;
      const nextBubble =
        bubbleId === undefined ? existing.bubble_id : bubbleId === null ? null : bubbleId;

      await driver.run(
        sql(
          `UPDATE oc_contexts
           SET content = ?, tags = ?, bubble_id = ?, updated_at = ?
           WHERE id = ?`,
        ),
        [content, nextTags, nextBubble, updatedAt, id],
      );
      return rowToEntry({
        ...existing,
        content,
        tags: nextTags,
        bubble_id: nextBubble,
        updated_at: updatedAt,
      });
    },

    async deleteContext(id) {
      if (!(await findContextRow(id))) {
        return false;
      }
      await driver.run(sql('DELETE FROM oc_contexts WHERE id = ?'), [id]);
      return true;
    },

    async searchContexts(query) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0) {
        const rows = await driver.all<ContextRow>(
          `SELECT ${CONTEXT_COLUMNS} FROM oc_contexts ${CONTEXT_ORDER}`,
          [],
        );
        return rows.map(rowToEntry);
      }
      const haystack = `LOWER(${dialect.concat(['content', "' '", 'tags', "' '", 'source'])})`;
      const clauses = terms.map(() => `${haystack} LIKE ? ${LIKE_ESCAPE}`).join(' AND ');
      const rows = await driver.all<ContextRow>(
        sql(
          `SELECT ${CONTEXT_COLUMNS} FROM oc_contexts WHERE ${clauses} ${CONTEXT_ORDER}`,
        ),
        terms.map(likeTerm),
      );
      return rows.map(rowToEntry);
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
      await driver.run(
        sql(`INSERT INTO oc_bubbles (${BUBBLE_COLUMNS}) VALUES (?, ?, ?, ?, ?)`),
        [bubble.id, name, description ?? null, now, now],
      );
      return bubble;
    },

    async listBubbles() {
      const rows = await driver.all<BubbleRow>(
        `SELECT ${BUBBLE_COLUMNS} FROM oc_bubbles ${CONTEXT_ORDER}`,
        [],
      );
      return rows.map(rowToBubble);
    },

    async getBubble(id) {
      const row = await findBubbleRow(id);
      return row ? rowToBubble(row) : undefined;
    },

    async updateBubble(id, name, description) {
      const existing = await findBubbleRow(id);
      if (!existing) {
        return undefined;
      }
      const updatedAt = new Date().toISOString();
      const nextDescription = description !== undefined ? description : existing.description;
      await driver.run(
        sql('UPDATE oc_bubbles SET name = ?, description = ?, updated_at = ? WHERE id = ?'),
        [name, nextDescription, updatedAt, id],
      );
      return rowToBubble({
        ...existing,
        name,
        description: nextDescription,
        updated_at: updatedAt,
      });
    },

    async deleteBubble(id, deleteContexts = false) {
      if (!(await findBubbleRow(id))) {
        return false;
      }
      await driver.run(sql('DELETE FROM oc_bubbles WHERE id = ?'), [id]);
      if (deleteContexts) {
        await driver.run(sql('DELETE FROM oc_contexts WHERE bubble_id = ?'), [id]);
      } else {
        await driver.run(
          sql('UPDATE oc_contexts SET bubble_id = NULL WHERE bubble_id = ?'),
          [id],
        );
      }
      return true;
    },
  };
}

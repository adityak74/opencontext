# BYODB — Bring Your Own Database

**Date:** 2026-08-17
**Status:** Implemented
**Revised:** 2026-08-17 — scope widened from 5 backends to 15 during implementation
(Azure SQL, Cloud SQL, DynamoDB, MySQL, MongoDB, Redis, Firestore, D1, memory added
at the user's request).
**Branch:** `feat/byodb`

## Problem

opencontext persists every saved context and bubble in a single JSON file at
`~/.opencontext/contexts.json`. `src/mcp/store.ts` reads and rewrites that entire
file on every operation. This works for a laptop with a few hundred entries and
fails everywhere else:

- The whole store is rewritten per write, so cost grows with total size, not change size.
- Two processes writing concurrently (MCP server + HTTP server) can lose writes.
- There is no way to point opencontext at a database the user already runs.
- There is no remote option, so context cannot be shared across machines.

## Goal

Let users point opencontext at the database of their choice — embedded or remote —
without changing how the CLI, HTTP API, or MCP tools behave. The JSON file stays
the zero-configuration default so existing installs keep working untouched.

## Scope

**In scope:** contexts and bubbles — everything currently in `contexts.json`.

**Out of scope:** `preferences.json`, `preferences.md`, and `memory.md` stay as
files on disk. They are generated artifacts that Claude reads directly from the
filesystem; moving them into a database would break that contract for no gain.

**Explicitly not built (YAGNI):** connection pool tuning, vector or semantic
search, multi-user auth, schema migration beyond initial creation.

## Architecture

### The central change: the store becomes async

Today `createStore()` returns an object of synchronous methods. Every database
driver is asynchronous, so the store interface must become async. Both consumers
(`src/server.ts` Express handlers and `src/mcp/server.ts` tool handlers) already
execute inside async contexts, so this ripple is mechanical: add `async`/`await`.

### Approach: shared cores plus thin per-engine bindings

The backends fall into families, and CRUD is written **once per family**:

| Family | Shared implementation | Per-engine work | Backends |
|---|---|---|---|
| File | `adapters/json.ts` | — | json |
| SQL | `adapters/sql.ts` + `Dialect` | placeholder style, DDL, concat, ~50-line driver | sqlite, libsql, d1, duckdb, postgres, cloudsql, mysql, mssql |
| Document / KV | `adapters/document.ts` + `DocumentDriver` | six methods (get/put/remove/list/ping/connect) | memory, mongodb, redis, firestore, dynamodb |
| Multi-model | `adapters/surreal.ts` | bespoke | surrealdb |

This is a small fraction of the code of fifteen independent adapters, and — more
importantly — search and ordering semantics cannot drift between backends in a
family, because there is only one implementation of them.

The `Dialect` carries everything that genuinely differs between SQL engines:
placeholder style (`?` / `$1` / `@p1`), DDL (SQL Server has no
`CREATE TABLE IF NOT EXISTS`; MySQL cannot index an unbounded `TEXT` key), and
string concatenation (`||` versus `+` versus `CONCAT()`).

### Layout

```
src/store/
├── types.ts              ContextStoreAdapter, AdapterInfo, DbScheme
├── dsn.ts                parse / validate / redact connection strings
├── config.ts             ~/.opencontext/config.json read + write (mode 0600)
├── resolve.ts            precedence chain producing the effective DSN
├── registry.ts           scheme → adapter loader, driver-availability probing
├── index.ts              createStore(dsn) factory
├── manager.ts            StoreManager — lazy connect, hot reconnect
├── migrate.ts            copy all data between two adapters
├── adapters/
│   ├── json.ts           today's file store, async (DEFAULT)
│   ├── sql.ts            shared SQL CRUD over SqlDriver + Dialect
│   └── surreal.ts        bespoke, SurrealQL
└── drivers/
    ├── sqlite.ts         node:sqlite built-in; @libsql/client for libsql://
    ├── postgres.ts       pg
    └── duckdb.ts         @duckdb/node-api
```

`src/mcp/store.ts` becomes a thin re-export of the new module so any external
importer keeps resolving.

### The adapter interface

```ts
interface ContextStoreAdapter {
  readonly info: AdapterInfo;
  connect(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<void>;

  saveContext(content, tags?, source?, bubbleId?): Promise<ContextEntry>;
  recallContext(query): Promise<ContextEntry[]>;
  listContexts(tag?): Promise<ContextEntry[]>;
  listContextsByBubble(bubbleId): Promise<ContextEntry[]>;
  getContext(id): Promise<ContextEntry | undefined>;
  updateContext(id, content, tags?, bubbleId?): Promise<ContextEntry | undefined>;
  deleteContext(id): Promise<boolean>;
  searchContexts(query): Promise<ContextEntry[]>;

  createBubble(name, description?): Promise<Bubble>;
  listBubbles(): Promise<Bubble[]>;
  getBubble(id): Promise<Bubble | undefined>;
  updateBubble(id, name, description?): Promise<Bubble | undefined>;
  deleteBubble(id, deleteContexts?): Promise<boolean>;
}
```

Method signatures are otherwise unchanged from today's store, so call sites only
gain an `await`.

`AdapterInfo` is `{ scheme, label, target, remote }` where `target` is always
**redacted** — it is returned over HTTP to the UI.

## Connection strings

| Scheme | Driver | Dependency |
|---|---|---|
| `json:///path/contexts.json` | `node:fs` | none — **default** |
| `sqlite:///path/oc.db`, `sqlite::memory:` | `node:sqlite` | **none** (Node 25 built-in) |
| `libsql://host?authToken=…` | `@libsql/client` | optional |
| `postgres://user:pass@host:5432/db` | `pg` | optional |
| `duckdb:///path/oc.duckdb` | `@duckdb/node-api` | optional |
| `surrealdb://user:pass@host:8000/ns/db` | `surrealdb` | optional |

`postgresql://` is accepted as an alias for `postgres://`. SurrealDB accepts
`ws://` and `wss://` aliases; its path segment is `/<namespace>/<database>`.

### Resolution precedence

1. `OPENCONTEXT_DB_URL` environment variable
2. `database.url` in `~/.opencontext/config.json`
3. `OPENCONTEXT_STORE_PATH` — legacy, mapped to `json://<path>`
4. Default: `json://~/.opencontext/contexts.json`

Environment always wins over the config file, so a container can override whatever
a user saved from the UI.

### Optional drivers

Drivers are declared as `peerDependencies` with `peerDependenciesMeta.optional`,
which npm does **not** auto-install. The default install and the Docker image stay
lean. An adapter `await import()`s its driver on first connect; a missing module
produces an actionable error rather than a stack trace:

```
Postgres driver is not installed.
Install it with:  npm install pg
```

## SQL schema

```sql
CREATE TABLE IF NOT EXISTS oc_bubbles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oc_contexts (
  id         TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  tags       TEXT NOT NULL,   -- JSON-encoded string[]
  source     TEXT NOT NULL,
  bubble_id  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`tags` is a JSON-encoded text column rather than a native array or JSONB. Every
target engine stores and compares text identically, which keeps the shared CRUD
free of dialect branches. Tag filtering and search run over the encoded text with
`LOWER(...) LIKE ...`, preserving today's case-insensitive substring semantics
exactly.

Timestamps are ISO-8601 strings, matching the existing JSON store, so migration is
a straight copy with no conversion.

### Ordering contract

Every adapter returns contexts and bubbles ordered by **`created_at` ascending,
then `id` ascending**.

This is a deliberate, documented change from the JSON store's implicit insertion
order. Two entries written in the same millisecond previously came back in
insertion order; they now come back in UUID order. In exchange, ordering is
*identical and deterministic* across all five backends, which makes a shared
conformance suite possible. The JSON adapter sorts on read to match.

## Configuration surface

### HTTP API

| Route | Purpose |
|---|---|
| `GET /api/db/status` | current adapter, redacted target, connected, entry/bubble counts |
| `GET /api/db/adapters` | supported schemes, labels, and whether each driver is installed |
| `POST /api/db/test` | connect to a candidate DSN, run `ping()`, disconnect; report ok or the driver error |
| `PUT /api/db/config` | persist DSN to config file, hot-swap the live store |
| `POST /api/db/migrate` | copy all contexts and bubbles from the live store into a target DSN |

`POST /api/db/migrate` takes `{ url, mode }` where `mode` is `"copy"` (default,
additive) or `"replace"` (target is cleared first). It returns counts of what was
transferred.

### Web UI

New route `/settings` rendering `DatabaseSettings.tsx`, linked from the sidebar:

- current backend, with a badge for local vs remote
- adapter picker that fills in a scheme-appropriate DSN template
- connection-string field with a **Test connection** button reporting the real driver error on failure
- **Save** to persist, and **Migrate my data here** to copy the existing store across
- an install hint when the chosen adapter's driver is not present

### CLI

```
opencontext db status
opencontext db adapters
opencontext db test <dsn>
opencontext db migrate --to <dsn> [--replace]
```

## Store lifecycle

`StoreManager` owns the live adapter. It connects **lazily on first use** rather
than at module load, which keeps `src/server.ts` synchronously importable — the
test suite imports `app` directly via supertest, and top-level `await` there would
change module semantics for every existing test.

`reconnect(dsn)` closes the current adapter, opens the new one, and swaps it in.
If the new adapter fails to connect, the previous one is retained and the error is
returned — a bad connection string entered in the UI cannot take the store down.

## Error handling

- Unknown or malformed DSN → `400` from the API, non-zero exit from the CLI, with the list of supported schemes.
- Missing optional driver → error naming the exact `npm install` command.
- Connection failure → the driver's own message is surfaced verbatim (minus credentials) because it is the only useful diagnostic.
- Migration failure → partial progress is reported; the source store is never mutated by a migration.

## Security

Connection strings carry passwords.

- `~/.opencontext/config.json` is written with mode `0600`.
- `redactDsn()` replaces the password component with `***`; every API response, log line, and `AdapterInfo.target` passes through it.
- The UI never receives a stored password back — the DSN field shows the redacted form and only sends a new value when the user types a full replacement.
- Nothing leaves the machine. Remote connections go directly from the user's process to the user's database, consistent with the project's local-only privacy stance.

## Testing

The core testing move is a **shared conformance suite** at
`tests/store/conformance.ts`, exported as a function taking an adapter factory. It
covers every case in today's `tests/mcp/store.test.ts` plus bubble unassign-vs-cascade
delete, tag filtering, multi-term search, and the ordering contract.

It runs unconditionally against one backend from each family, so all three shared
implementations are covered with no external dependency:

- **JSON** — the file adapter
- **SQLite** — the shared SQL core, via Node's built-in `node:sqlite`
- **memory** — the shared document core

Every other backend runs when its connection string is in the environment.
`docker-compose.test.yml` brings up Postgres, MySQL, SQL Server, MongoDB, Redis,
SurrealDB and DynamoDB Local on non-default ports so they cannot collide with
anything already running.

Additional tests:

- `tests/store/dsn.test.ts` — parsing for every scheme, aliases, malformed input, and redaction
- `tests/store/config.test.ts` — precedence chain and file permissions
- `tests/store/migrate.test.ts` — JSON → SQLite copy and replace, verified by reading back through the target adapter
- `tests/server.test.ts` — updated mock store returns promises; new `/api/db/*` route tests
- `ui/src/components/__tests__/DatabaseSettings.test.tsx` — render, test-connection success and failure, save

## Rollout

No migration is required. An existing install with no configuration continues to
resolve to `json://~/.opencontext/contexts.json` and reads the same file it always
has. Users opt in by setting `OPENCONTEXT_DB_URL` or saving a connection from the
settings page, then running a migration to carry their history across.

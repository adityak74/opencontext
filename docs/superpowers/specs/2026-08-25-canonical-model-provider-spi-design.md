# Open Context 2.0: Canonical Data Model (OCM 2.0) & Provider SPI / SDK Design

**Date:** 2026-08-25  
**Status:** Approved  
**Author:** Open Context Team  
**Sub-Project:** 1 of 5 (Foundation Layer)  
**Branch:** `feat/opencontext-2.0`  

---

## 1. Problem Statement

Open Context 1.x stores context as flat, synchronous-derived `ContextEntry` and `Bubble` objects across 15 different database drivers. While functional for single-agent key-value memory, this architecture suffers from several critical limitations:
1. **Model Simplicity:** The schema lacks explicit representation for context types (decisions, constraints, artifacts, observations), multi-tenant namespaces, causal/graph relationships, cryptographic provenance, and distributed vector clocks.
2. **Monolithic Coupling:** Storage drivers are tightly coupled directly inside the core repository, making it difficult for the external ecosystem to author custom certified database adapters.
3. **Lowest-Common-Denominator CRUD:** Backends do not advertise or negotiate their native capabilities (e.g. FTS, vector embeddings, graph traversal, transactions), forcing all interactions through basic string search and list filtering.

## 2. Goals & Invariants

### 2.1 Goals
- **Canonical Model (OCM 2.0):** Standardize all persistent context into a rich, versioned, relational-graph entity (`CanonicalContext`).
- **Provider SPI & SDK:** Define a formal `ContextStore` Storage Provider Interface and publish `@opencontext/provider-sdk` with shared abstract family base classes (`SqlContextStore`, `DocumentContextStore`, `JsonContextStore`, `SurrealContextStore`).
- **Monorepo Workspaces:** Refactor the repository into clean npm workspaces (`@opencontext/core`, `@opencontext/provider-sdk`, `@opencontext/provider-*`, `opencontext`).
- **Zero Regression / Dual-Layer Shims:** Retain 100% backward compatibility for existing MCP tools (`save_context`, `recall_context`, `list_bubbles`, etc.) and REST endpoints via automatic bidirectional translation shims (`ContextStoreV1Shim`).

### 2.2 Invariants & Non-Goals
- **Non-Goal:** Full distributed synchronization and wire protocol implementation (deferred to Sub-Project 4: CSTP & Delta Sync).
- **Non-Goal:** Real-time CDC subscriptions (deferred to Sub-Project 2: Reactive Engine).
- **Invariant:** Existing local installations using zero-configuration JSON or SQLite must seamlessly upgrade without data loss.

---

## 3. Architecture & Monorepo Hierarchy

The repository transitions to an npm workspace layout:

```text
opencontext/
├── package.json                     # Root workspace configuration
├── packages/
│   ├── core/                        # @opencontext/core
│   │   ├── src/
│   │   │   ├── model/               # CanonicalContext, ContextType, LifecycleState
│   │   │   ├── query/               # ContextQuery AST, filter compiler, pagination
│   │   │   ├── shims/               # v1 ContextEntry / Bubble compatibility mapper
│   │   │   ├── identity/            # ULID generator, SHA-256 provenance hashing
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── provider-sdk/                # @opencontext/provider-sdk
│   │   ├── src/
│   │   │   ├── spi.ts               # ContextStore interface, ContextStoreCapabilities
│   │   │   ├── base/                # Shared family base classes:
│   │   │   │   ├── sql-base.ts      # SqlContextStore + SQL dialects
│   │   │   │   ├── doc-base.ts      # DocumentContextStore + document drivers
│   │   │   │   ├── json-base.ts     # JsonContextStore (local file)
│   │   │   │   └── memory-base.ts   # MemoryContextStore (in-memory testing)
│   │   │   ├── dsn.ts               # Universal DSN parser & resolver
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── providers/                   # Thin engine-specific provider packages
│   │   ├── provider-sqlite/         # @opencontext/provider-sqlite
│   │   ├── provider-postgres/       # @opencontext/provider-postgres
│   │   ├── provider-redis/          # @opencontext/provider-redis
│   │   ├── provider-mongodb/        # @opencontext/provider-mongodb
│   │   └── ...                      # (dynamodb, firestore, duckdb, surrealdb, etc.)
│   │
│   └── cli/                         # opencontext (Root CLI, HTTP Server, MCP Server, UI)
│       ├── src/
│       │   ├── mcp/                 # MCP Server (exposes v1 tools via shims + v2 native tools)
│       │   ├── server.ts            # Express REST API
│       │   └── index.ts             # CLI entrypoint
│       └── package.json
```

---

## 4. Canonical Open Context Model (OCM 2.0)

### 4.1 Data Schema

```ts
export type ContextId = string;       // ULID monotonic ID or URI
export type NamespaceId = string;     // Multi-tenant partition (default: "default")
export type ScopeId = string;         // e.g. "global", "project:zorp", "session:sess_123"

export type ContextType =
  | 'message'        // Direct conversational utterance or prompt
  | 'fact'           // Atomic piece of verified knowledge
  | 'decision'       // Architecture/design decision made
  | 'constraint'     // Hard rule or operating boundary
  | 'preference'     // User, system, or project preference
  | 'artifact'       // Code snippet, document, diff, or file reference
  | 'observation'    // Environment state, run output, inspection result
  | 'tool_result'    // Execution result of an external tool or action
  | 'summary'        // Compressed abstraction of a larger context sequence
  | 'checkpoint'     // System snapshot or state marker
  | (string & {});   // Extensible custom domain types

export type LifecycleState =
  | 'active'         // Queryable, active in context window
  | 'archived'       // Retained for historical reference
  | 'deprecated'     // Superseded by newer context entry
  | 'soft_deleted'   // Marked for deletion, pending TTL garbage collection
  | 'pinned';        // Immune to automatic pruning

export interface RelationshipEdge {
  targetId: ContextId;
  relation:
    | 'supersedes'
    | 'derived_from'
    | 'references'
    | 'child_of'
    | 'caused_by'
    | string;
  metadata?: Record<string, unknown>;
}

export interface ContextProvenance {
  actor: 'user' | 'agent' | 'system' | 'integration';
  agentId?: string;
  model?: string;
  sourceUri?: string;
  signature?: string;
  contentHash: string;               // SHA-256 hash of normalized content payload
  derivationChain?: ContextId[];
}

export interface CanonicalContext {
  id: ContextId;
  namespace: NamespaceId;
  scope: ScopeId;
  type: ContextType;
  content: {
    text?: string;
    structured?: Record<string, unknown>;
    mediaType?: string;              // e.g. "text/markdown", "application/json"
    embedding?: number[];
  };
  metadata: Record<string, unknown>;
  provenance: ContextProvenance;
  relationships: RelationshipEdge[];
  timestamps: {
    createdAt: string;               // ISO-8601 UTC
    updatedAt: string;               // ISO-8601 UTC
    accessedAt?: string;
    expiresAt?: string;              // TTL support
  };
  version: {
    revision: number;
    clock?: Record<string, number>;  // Vector clock for distributed sync
  };
  lifecycle: LifecycleState;
}
```

---

## 5. Provider SPI & SDK (`@opencontext/provider-sdk`)

### 5.1 Storage Provider Interface

```ts
export interface ContextStoreCapabilities {
  fullTextSearch: boolean;
  vectorSearch: boolean;
  graphTraversal: boolean;
  atomicTransactions: boolean;
  optimisticLocking: boolean;
  nativeTtl: boolean;
  changeStreams: boolean;
  durableCursors: boolean;
}

export interface ContextQuery {
  namespace: string;
  scope?: string | string[];
  types?: ContextType[];
  lifecycle?: LifecycleState[];
  filter?: Record<string, unknown>;
  fullText?: string;
  vector?: {
    embedding: number[];
    topK: number;
    minSimilarity?: number;
  };
  relationships?: {
    relatedTo: ContextId;
    relation?: string;
    depth?: number;
  };
  pagination?: {
    limit: number;
    cursor?: string;
    order?: 'asc' | 'desc';
    orderBy?: 'createdAt' | 'updatedAt' | 'revision';
  };
}

export interface ContextBatchMutation {
  puts?: CanonicalContext[];
  updates?: Array<{ id: ContextId; expectedRevision: number; patch: Partial<CanonicalContext> }>;
  deletes?: ContextId[];
}

export interface ContextStore {
  readonly id: string;
  readonly capabilities: ContextStoreCapabilities;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<void>;

  put(context: CanonicalContext): Promise<CanonicalContext>;
  get(id: ContextId, namespace: string): Promise<CanonicalContext | undefined>;
  query(query: ContextQuery): Promise<{ items: CanonicalContext[]; nextCursor?: string; totalCount?: number }>;
  update(id: ContextId, namespace: string, expectedRevision: number, patch: Partial<CanonicalContext>): Promise<CanonicalContext>;
  delete(id: ContextId, namespace: string, hard?: boolean): Promise<boolean>;
  batch(mutation: ContextBatchMutation): Promise<{ applied: boolean; committedRevision: number }>;
}
```

### 5.2 Family Base Classes

- **`SqlContextStore` (`sql-base.ts`):** Handles standardized relational table management (`id`, `namespace`, `scope`, `type`, `content_json`, `metadata_json`, `provenance_json`, `relationships_json`, `created_at`, `updated_at`, `revision`, `lifecycle`). Utilizes pluggable `SqlDialect` implementations for SQLite, PostgreSQL, MySQL, MSSQL, DuckDB, LibSQL, and D1.
- **`DocumentContextStore` (`doc-base.ts`):** Normalizes JSON document storage, indexing, and optimistic locking over thin `DocumentDriver` connectors (MongoDB, Redis, Firestore, DynamoDB, Memory).
- **`JsonContextStore` (`json-base.ts`):** Provides atomic, zero-dependency filesystem persistence via temp-file write & rename semantics.
- **`SurrealContextStore` (`surreal-base.ts`):** Maps `relationships` natively to SurrealQL graph edges.

---

## 6. Backward Compatibility & Virtual Shims

### 6.1 `ContextStoreV1Shim`
All existing MCP tools (`save_context`, `recall_context`, `list_contexts`, `update_context`, `delete_context`, `create_bubble`, `list_bubbles`) interface with the storage layer through `ContextStoreV1Shim`:

1. **Write Translation:**
   - `tags` $\rightarrow$ `metadata.tags`
   - `source` $\rightarrow$ `provenance.sourceUri` and `provenance.actor`
   - `bubbleId` $\rightarrow$ `relationships: [{ targetId: bubbleId, relation: 'child_of' }]` and `scope: 'bubble:<id>'`
   - `content` $\rightarrow$ `content.text` (with SHA-256 hash in `provenance.contentHash`)
2. **Read Translation:**
   - Converts `CanonicalContext` back into `ContextEntry` transparently for v1 consumers.
3. **New 2.0 MCP Tools:**
   - Exposes `save_canonical_context` and `query_canonical_context` alongside legacy tools for v2-aware clients.

---

## 7. Verification & Testing Strategy

1. **Domain Logic Tests (`@opencontext/core`):**
   - Verification of `CanonicalContext` serialization, ULID monotonic ordering, SHA-256 content hashing, and complete bidirectional `ContextStoreV1Shim` fidelity.
2. **Provider SPI Contract Suite (`@opencontext/provider-sdk`):**
   - Parameterized test harness executed across `MemoryContextStore`, `JsonContextStore`, and `SqlContextStore` (SQLite).
   - Verifies optimistic concurrency on `revision`, complex scope filtering, full-text search fallback, and hard/soft deletion.
3. **End-to-End Regression Suite (`opencontext` CLI/MCP):**
   - Live integration tests against the MCP server and Express REST API ensuring zero regressions for Claude Code, Cursor, and existing clients.

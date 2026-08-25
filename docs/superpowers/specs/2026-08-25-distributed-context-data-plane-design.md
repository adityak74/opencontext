# Open Context 2.0: Distributed Context Data Plane & Scalability Design

**Date:** 2026-08-25  
**Status:** Approved  
**Author:** Open Context Team  
**Sub-Project:** 2 of 5 (Distributed & Scalability Architecture)  
**Branch:** `feat/opencontext-2.0`  

---

## 1. Executive Summary & Scaling Philosophy

Open Context scales as a **distributed context data plane**, not a centralized distributed database.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                  "Don't build a giant distributed database.                 │
│   Build a distributed layer that makes existing databases behave like one    │
│                            context system."                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

The data plane deploys lightweight, stateless **Open Context Nodes (OC-Nodes)** directly adjacent to customer databases (PostgreSQL RDS, MongoDB Atlas, Redis Cloud, local SQLite). The customer retains physical data ownership while Open Context provides:
- Identity, canonical semantics, and sharding.
- Reactive event streaming, CDC capture, and durable cursors.
- Direct node-to-node state transfer (CSTP) with credit backpressure.
- Capability-aware federation directory and query planning.

---

## 2. Three-Plane Architecture

```text
                               CONTROL PLANE
                  ┌─────────────────────────────────────┐
                  │ Namespaces / Routing / Auth / Policy│
                  │ Provider Registry & Capabilities    │
                  │ Subscription & Federation Directory │
                  └──────────────────┬──────────────────┘
                                     │ (Control & Route Metadata)
                                     ▼
                                DATA PLANE
        ┌─────────────────────────────────────────────────────────┐
        │  Open Context Node A               Open Context Node B  │
        │         │                                   │           │
        │    PostgreSQL                             Redis         │
        │         │                                   │           │
        │         └────── Direct gRPC / CSTP ─────────┘           │
        └────────────────────────────┬────────────────────────────┘
                                     │ (CDC & Outbox Feeds)
                                     ▼
                               EVENT PLANE
        ┌─────────────────────────────────────────────────────────┐
        │  Normalized ContextEvent Stream (NATS JetStream / SQLite│
        │  Durable Cursors / Checkpoints / Subscriptions          │
        └─────────────────────────────────────────────────────────┘
```

1. **Control Plane (Orchestration & Governance):**
   - Resolves namespace shard routing (`hash(namespace) -> Shard ID -> Target Node`).
   - Manages the **Federation Directory** and node capability matrix.
   - Enforces multi-tenant authorization policies (RBAC/ABAC on namespaces and scopes).
2. **Data Plane (Execution & Direct Transfer):**
   - **Open Context Node (OC-Node):** Stateless service co-located with physical databases.
   - Implements `ContextStore` SPI for native database CRUD and query execution.
   - Executes direct peer-to-peer data transfers via gRPC CSTP streams.
3. **Event Plane (Reactive Fabric):**
   - Normalizes database mutations (CDC or Transactional Outbox) into universal `ContextEvent` records.
   - Buffers events in an `EventBackend` log with sequence offsets and subscriber checkpoints.

---

## 3. Namespace Sharding & Ordering Invariant

### 3.1 Partition Key
Every context object belongs to an explicit `namespace` (e.g. `user:123`, `project:zorp`, `org:aviskaar`):
```text
hash(namespace) ──► Partition / Shard ID ──► Target OC-Node Fleet ──► Target Database Cluster
```

### 3.2 Ordering Guarantee
- **Global Invariant:** Global total ordering across all tenants is NOT enforced.
- **Local Invariant:** Strict, monotonic causal ordering is guaranteed **within each individual context namespace**.

---

## 4. Normalized `ContextEvent` & `EventBackend` SPI

### 4.1 `ContextEvent` Schema (`@opencontext/core`)

```ts
export type EventOperation = 'INSERT' | 'UPDATE' | 'DELETE' | 'LIFECYCLE_CHANGE' | 'CHECKPOINT';

export interface ContextEvent<T = Record<string, unknown>> {
  eventId: string;             // Monotonic ULID
  namespace: string;           // Shard key & ordering boundary
  objectId: string;            // Target CanonicalContext ID
  operation: EventOperation;
  version: number;             // Monotonic revision number within namespace
  origin: string;              // Originating node identifier (e.g. "node-us-east-1a")
  timestamp: string;           // ISO-8601 UTC + Hybrid Logical Clock
  checkpointCursor: string;    // Resumable stream token
  contentHash: string;         // SHA-256 hash of payload for verification
  payload: {
    previousRevision?: number;
    before?: Partial<T>;
    after?: T;
    patch?: Record<string, unknown>;
  };
}
```

### 4.2 `EventBackend` SPI (`@opencontext/provider-sdk`)

```ts
export interface EventPublishAck {
  sequenceNumber: bigint;
  cursor: string;
  publishedAt: string;
}

export interface ConsumerOptions {
  consumerGroup: string;
  namespace: string;
  startCursor?: string;
  deliveryPolicy: 'all' | 'new' | 'from_cursor';
  ackWaitMs: number;
}

export interface EventBackend {
  readonly id: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<void>;

  /** Publish normalized event to the namespace stream */
  publish(event: ContextEvent): Promise<EventPublishAck>;

  /** Open a durable, resumable consumer stream */
  subscribe(opts: ConsumerOptions): AsyncIterable<{
    event: ContextEvent;
    ack(): Promise<void>;
    nack(): Promise<void>;
  }>;
}
```

### 4.3 Tri-Tier Drivers
- **`InMemoryEventBackend`:** Ephemeral in-process ring buffer for unit tests and ephemeral CLI sessions.
- **`SqliteEventLog`:** Local `context_events` table with monotonic sequence IDs and indexing on `(namespace, sequence_num)` for zero-dependency local deployments (`opencontext start`).
- **`NatsJetStreamEventBackend`:** Distributed engine mapping namespaces to JetStream subjects (`OPENCONTEXT.EVENTS.{namespace}.>`) with durable pull consumers and explicit sequence acknowledgements.

---

## 5. Stateless Subscription Fleet & Durable Cursors

### 5.1 Durable Subscription State Machine

```ts
export interface DurableSubscription {
  subscriptionId: string;
  namespace: string;
  subscriberEndpoint: string;        // WebSocket ID, SSE channel, or Webhook URI
  predicate: {
    scopes?: string[];               // e.g. ["project:zorp", "session:sess_1"]
    types?: string[];                // e.g. ["decision", "artifact"]
    operations?: EventOperation[];   // e.g. ["INSERT", "UPDATE"]
  };
  lastAcknowledgedCursor: string;    // Monotonic sequence checkpoint
  deliveryPolicy: 'at_least_once' | 'fire_and_forget';
  expiresAt?: string;
}
```

### 5.2 Crash Recovery & Zero-Loss Replay
1. **Durable Offsets:** Matchers persist `lastAcknowledgedCursor` per subscription.
2. **Failover:** If a matcher worker crashes, a standby worker reloads the subscription metadata, connects to `EventBackend.subscribe({ startCursor })`, and replays unacknowledged events.
3. **Idempotency:** Agents deduplicate messages using `eventId + objectId + version`.

---

## 6. Direct Data-Plane P2P Transfer & Backpressure (CSTP)

### 6.1 Direct Node-to-Node Transfer
Large context datasets move directly between Open Context Nodes via gRPC streams without passing through the central Control Plane.

### 6.2 Flow Control Primitives
- `WINDOW`: Defines initial byte/message window.
- `CREDIT`: Target node grants transmission credit to source.
- `ACK`: Acknowledges received sequence numbers.
- `CHECKPOINT`: Flushes state to persistent storage.
- `PAUSE`: Sent when target buffers exceed high watermark (credit = 0).
- `RESUME`: Restores transmission credit once storage buffers clear.

---

## 7. Federation Directory & Capability-Aware Query Planner

### 7.1 Federation Directory Mapping
The Control Plane maps context types and capabilities to specific storage nodes:
- `facts / decisions` $\rightarrow$ PostgreSQL Node (FTS + ACID)
- `working-state` $\rightarrow$ Redis Node (Sub-millisecond / TTL: 2h)
- `historical-logs` $\rightarrow$ DuckDB Node (Parquet / Analytical)
- `artifacts` $\rightarrow$ MongoDB Node (Large JSON Document)

### 7.2 Query Execution & Conflict Handling
- The Query Planner resolves target nodes from the Directory, pruning unneeded databases.
- Sub-queries execute in parallel across matching nodes.
- Merged entities are validated; conflicting versions with divergent hashes surface with `lifecycle: 'conflict_pending_resolution'`. Core protocol never invokes non-deterministic LLM arbitration.

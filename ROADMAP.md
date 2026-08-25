# Open Context Roadmap

> **Vision:** The open, storage-agnostic context data layer for AI agents.  
> **Core Promise:** *Bring your model. Bring your agent. Bring your database. Keep your context.*  
> **Guiding Philosophy:** **Persistent. Portable. Reactive.**

---

## The Big Picture: From Memory App to Context Data Plane

Open Context is evolving from a multi-database persistent memory store (v1.x) into a **distributed, reactive context data plane** (v2.0). 

Open Context owns the **logical context model, lifecycle semantics, reactive event streaming, and state transfer protocols**—while treating underlying databases (PostgreSQL, Redis, MongoDB, SQLite, DynamoDB, SurrealDB, DuckDB) as interchangeable physical execution engines.

```text
                               CONTROL PLANE
                  ┌─────────────────────────────────────┐
                  │ Namespaces / Routing / Auth / Policy│
                  │ Provider Registry & Capabilities    │
                  │ Subscription & Federation Directory │
                  └──────────────────┬──────────────────┘
                                     │ (Route & Control Metadata)
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

---

## Strategic Roadmap Phases

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                     OPEN CONTEXT RELEASE TIMELINE                         │
├─────────┬────────────────────────────┬────────────┬───────────────────────┤
│ Phase   │ Milestone                  │ Status     │ Target Version        │
├─────────┼────────────────────────────┼────────────┼───────────────────────┤
│ Phase 1 │ Canonical Model & SDK      │ In Progress│ v2.0-alpha            │
│ Phase 2 │ Reactive Event Subsystem   │ Planned    │ v2.0-beta             │
│ Phase 3 │ CSTP & Delta Engine        │ Planned    │ v2.0-rc               │
│ Phase 4 │ Conformance & Cert         │ Planned    │ v2.0-GA               │
│ Phase 5 │ Context Federation         │ Planned    │ v2.1+                 │
│ Phase 6 │ Higher-Order Extensions    │ Future     │ v2.2+                 │
└─────────┴────────────────────────────┴────────────┴───────────────────────┘
```

---

### Phase 1: Canonical Context Model (OCM 2.0) & Provider SPI / SDK
**Milestone:** `v2.0-alpha`  
**Focus:** Establishing the foundational data model, modular monorepo workspace, and storage provider interface without breaking existing 1.x installations.

- [x] **Architecture Specifications:** Author Master Spec (`docs/spec-open-context-2.0.md`) and Design Spec (`docs/superpowers/specs/2026-08-25-canonical-model-provider-spi-design.md`).
- [ ] **Workspace Refactoring:** Configure npm workspaces under `@opencontext/*` (`@opencontext/core`, `@opencontext/provider-sdk`, `@opencontext/provider-*`, `opencontext` CLI/MCP).
- [ ] **Canonical Data Model (`CanonicalContext`):**
  - Multi-tenant `namespace` and hierarchical `scope` support.
  - Native semantic context types: `message`, `fact`, `decision`, `constraint`, `preference`, `artifact`, `observation`, `tool_result`, `summary`, and `checkpoint`.
  - Cryptographic provenance with SHA-256 payload hashing and Ed25519 signatures.
  - Relational graph edges (`supersedes`, `derived_from`, `child_of`, `references`).
  - Distributed vector clocks and monotonic revision counters.
- [ ] **Storage Provider SPI (`ContextStore`):**
  - Define formal CRUD, batch mutation, and capability flags (`fullTextSearch`, `vectorSearch`, `graphTraversal`, `atomicTransactions`, `nativeTtl`).
  - Implement shared base classes in `@opencontext/provider-sdk`: `SqlContextStore`, `DocumentContextStore`, `JsonContextStore`, and `MemoryContextStore`.
- [ ] **Dual-Layer Compatibility Shim (`ContextStoreV1Shim`):**
  - Ensure 100% backward compatibility for existing MCP tools (`save_context`, `recall_context`, `list_bubbles`, etc.) and REST endpoints.
  - Expose new native 2.0 MCP tools (`save_canonical_context`, `query_canonical_context`).

---

### Phase 2: Reactive DB Abstraction & Durable Event Engine
**Milestone:** `v2.0-beta`  
**Focus:** Transforming Open Context into a reactive context fabric where agents subscribe to context mutations instead of polling.

- [x] **Architecture Specification:** Author Distributed Data Plane Spec (`docs/spec-distributed-context-data-plane.md`).
- [ ] **Normalized `ContextEvent` Pipeline:**
  - Standardize all database mutations into universal `ContextEvent` records (`eventId`, `namespace`, `objectId`, `operation`, `version`, `origin`, `checkpointCursor`, `contentHash`).
- [ ] **Pluggable `EventBackend` SPI:**
  - `InMemoryEventBackend`: Ephemeral in-process bus for unit testing and local CLI tasks.
  - `SqliteEventLog`: Persistent local change log with sequence indexing for zero-dependency local use (`opencontext start`).
  - `NatsJetStreamEventBackend`: Production distributed event log mapping namespaces to JetStream subject streams (`OPENCONTEXT.EVENTS.{namespace}.>`).
- [ ] **Durable Subscription Manager & Cursors:**
  - Durable subscription registry with predicate filtering (`scopes`, `types`, `operations`).
  - Crash recovery & replay from `lastAcknowledgedCursor`.
  - At-least-once delivery with client-side idempotency (`eventId + objectId + version`).
- [ ] **Reactive Transports:**
  - Server-Sent Events (SSE) `/api/context/events` streaming endpoint.
  - MCP reactive tools: `subscribe_context` and `ack_event`.

---

### Phase 3: Context State Transfer Protocol (CSTP) & Delta Synchronization
**Milestone:** `v2.0-rc`  
**Focus:** High-throughput, storage-agnostic state synchronization and cross-database migration.

- [ ] **CSTP Protocol Specification & Frame Engine:**
  - Bidirectional gRPC / WebSocket protocol with standard primitives: `HELLO`, `CAPABILITIES`, `MANIFEST`, `REQUEST`, `TRANSFER`, `SNAPSHOT`, `DELTA`, `SUBSCRIBE`, `EVENT`, `ACK`, `CHECKPOINT`, and `RESUME`.
- [ ] **Git-Like Delta Synchronization:**
  - Incremental state synchronization (`added`, `updated`, `deleted`, `checkpoint`) over vector clocks without transferring bulk state.
- [ ] **Credit-Based Streaming Flow Control:**
  - Backpressure primitives (`WINDOW`, `CREDIT`, `ACK`, `PAUSE`, `RESUME`) to prevent fast nodes from overwhelming slower targets.
- [ ] **Cross-Database Migration CLI:**
  - `opencontext migrate <src-dsn> <dst-dsn>`: Full migration preserving IDs, timestamps, provenance, versions, and relationships.
  - `opencontext transfer --source <dsn> --target <dsn> --scope <scope>`: Scoped context slice transfer.

---

### Phase 4: Conformance Suite & Ecosystem Certification
**Milestone:** `v2.0-GA`  
**Focus:** Empowering the community to build and certify external database providers.

- [ ] **Conformance Test CLI (`opencontext provider test`):**
  - Automated black-box validation suite testing CRUD, filtering, pagination, subscriptions, versioning, and ACID transactions.
- [ ] **4-Tier "Open Context Compatible" Certification Matrix:**
  - *Level 1 (Core Persistence):* CRUD, Canonical OCM normalization, revision checks.
  - *Level 2 (Advanced Query):* Full-text search, pagination, relational graph traversal.
  - *Level 3 (Reactive & Streaming):* Change feeds, durable subscriptions, cursor resume, acks.
  - *Level 4 (Full Enterprise):* Vector similarity, ACID batches, native TTL expiry, graph relations.
- [ ] **Official Provider Suite Upgrade:**
  - Upgrade and certify all 15 drivers (Postgres, Redis, Mongo, SQLite, DynamoDB, SurrealDB, DuckDB, Firestore, D1, LibSQL, MySQL, MSSQL, Cloud SQL).

---

### Phase 5: Heterogeneous Context Federation
**Milestone:** `v2.1+`  
**Focus:** Unifying disparate storage engines into a single logical context space.

- [ ] **Federation Directory:**
  - Index mapping namespaces and context types to optimal physical stores (e.g. `decisions` $\rightarrow$ Postgres, `working-state` $\rightarrow$ Redis, `history` $\rightarrow$ DuckDB).
- [ ] **Capability-Aware Query Planner:**
  - Intelligent query routing that selectively queries relevant nodes rather than broadcasting expensive scatter-gather requests across all databases.
- [ ] **Distributed Consistency & Conflict Surfacing:**
  - Hybrid Logical Clocks (HLC) for distributed causal ordering.
  - Deterministic conflict surfacing (`conflict_pending_resolution`) without non-deterministic core LLM guessing.

---

### Phase 6: Higher-Order Intelligence Extensions
**Milestone:** `v2.2+`  
**Focus:** Decoupled semantic layers and framework integrations living strictly above the core infrastructure.

- [ ] **`@opencontext/compiler`:**
  - Token budget optimizer, context window packer, and semantic reranking for LLMs.
- [ ] **`@opencontext/extractor`:**
  - Intelligent memory extraction from raw transcripts using local models (Ollama) and cloud APIs (Claude/GPT).
- [ ] **`@opencontext/reconciler`:**
  - Heuristic and semantic contradiction detector with human/agent resolution workflows.
- [ ] **Framework Bridges:**
  - First-class adapters for LangChain, LlamaIndex, AutoGen, and CrewAI.

---

## Architectural Boundaries

To preserve strict separation of concerns across the modern AI stack:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                             THE AI STACK                                 │
├───────────────────┬──────────────────────────────────────────────────────┤
│ Protocol / Layer  │ Primary Role & Invariant                             │
├───────────────────┼──────────────────────────────────────────────────────┤
│ MCP               │ Moves Capabilities & Tools                           │
│ (Model Context)   │ "What tools, resources, and prompts can I access?"   │
├───────────────────┼──────────────────────────────────────────────────────┤
│ A2A               │ Moves Work & Delegation                              │
│ (Agent-to-Agent)  │ "Agent A assigns task X to Agent B."                 │
├───────────────────┼──────────────────────────────────────────────────────┤
│ Open Context /    │ Moves & Propagates Context State                     │
│ CSTP              │ "What context exists, where is it, how does it       │
│                   │  synchronize, and when has it changed?"              │
└───────────────────┴──────────────────────────────────────────────────────┘
```

---

## Key Specification Documents

- [**Master Specification (Open Context 2.0)**](docs/spec-open-context-2.0.md)
- [**Distributed Context Data Plane & Scalability Specification**](docs/spec-distributed-context-data-plane.md)
- [**Sub-Project 1 Design: Canonical Model & Provider SPI**](docs/superpowers/specs/2026-08-25-canonical-model-provider-spi-design.md)
- [**Sub-Project 1 Plan: Canonical Model & Provider SPI**](docs/superpowers/plans/2026-08-25-canonical-model-provider-spi.md)
- [**Sub-Project 2 Design: Distributed Data Plane & Reactive Events**](docs/superpowers/specs/2026-08-25-distributed-context-data-plane-design.md)
- [**Sub-Project 2 Plan: Distributed Data Plane & Reactive Events**](docs/superpowers/plans/2026-08-25-distributed-context-data-plane.md)

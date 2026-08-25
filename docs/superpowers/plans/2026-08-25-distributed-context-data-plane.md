# Distributed Context Data Plane & Scalability Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Open Context Distributed Event Plane with normalized `ContextEvent` schemas, pluggable `EventBackend` SPI (InMemory, SQLite, and NATS JetStream), durable subscription state machine, and reactive MCP/SSE event streams.

**Architecture:** Build a clean event-driven layer where storage mutations produce normalized `ContextEvent` records buffered in an `EventBackend`. Subscription workers evaluate consumer predicates and maintain durable sequence cursors for crash recovery and replay.

**Tech Stack:** Node.js 25+, TypeScript 5.9, Vitest, NATS.js (JetStream), SQLite3 / Better-SQLite3, Express (SSE), MCP SDK.

## Global Constraints

- Universal event schema: All storage mutations must normalize into `ContextEvent` records.
- Invariant: Strict monotonic ordering guaranteed within each individual context namespace (`namespace` partition key).
- Delivery guarantee: At-least-once with idempotent consumer keys (`eventId + objectId + version`).
- Resumability: Subscriptions persist sequence cursors (`lastAcknowledgedCursor`) to enable zero-loss replay after crashes.
- Tri-tier event log support: `InMemoryEventBackend` (ephemeral), `SqliteEventLog` (local zero-config), `NatsJetStreamEventBackend` (production distributed).

---

### Task 1: Normalized `ContextEvent` Model & Factory in `@opencontext/core`

**Files:**
- Create: `packages/core/src/events/types.ts`
- Create: `packages/core/src/events/factory.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/events.test.ts`

**Interfaces:**
- Produces: `ContextEvent`, `EventOperation`, `createContextEvent()`.

- [ ] **Step 1: Write failing test for `ContextEvent` creation and serialization**

Create `packages/core/tests/events.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createContextEvent } from '../src/events/factory.js';
import { createCanonicalContext } from '../src/model/factory.js';

describe('Normalized ContextEvent', () => {
  it('creates an INSERT event from a CanonicalContext entity', () => {
    const ctx = createCanonicalContext({
      content: { text: 'Reactive architecture approved' },
      type: 'decision',
      scope: 'project:zorp',
      namespace: 'org_alpha',
    });

    const event = createContextEvent({
      operation: 'INSERT',
      context: ctx,
      origin: 'node-us-east-1',
    });

    expect(event.eventId).toHaveLength(26);
    expect(event.namespace).toBe('org_alpha');
    expect(event.objectId).toBe(ctx.id);
    expect(event.operation).toBe('INSERT');
    expect(event.version).toBe(1);
    expect(event.origin).toBe('node-us-east-1');
    expect(event.payload.after).toEqual(ctx);
    expect(event.contentHash).toBe(ctx.provenance.contentHash);
    expect(event.timestamp).toBeTruthy();
  });

  it('creates an UPDATE event with before and after states', () => {
    const ctx1 = createCanonicalContext({ content: { text: 'Draft' } });
    const ctx2 = { ...ctx1, content: { text: 'Final' }, version: { revision: 2 } };

    const event = createContextEvent({
      operation: 'UPDATE',
      context: ctx2,
      previousContext: ctx1,
      origin: 'node-local',
    });

    expect(event.operation).toBe('UPDATE');
    expect(event.version).toBe(2);
    expect(event.payload.previousRevision).toBe(1);
    expect(event.payload.before).toEqual(ctx1);
    expect(event.payload.after).toEqual(ctx2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/events.test.ts`
Expected: FAIL with "Cannot find module '../src/events/factory.js'"

- [ ] **Step 3: Implement `ContextEvent` types and factory**

Create `packages/core/src/events/types.ts`:
```ts
import type { CanonicalContext } from '../model/types.js';

export type EventOperation = 'INSERT' | 'UPDATE' | 'DELETE' | 'LIFECYCLE_CHANGE' | 'CHECKPOINT';

export interface ContextEvent<T = CanonicalContext> {
  eventId: string;
  namespace: string;
  objectId: string;
  operation: EventOperation;
  version: number;
  origin: string;
  timestamp: string;
  checkpointCursor?: string;
  contentHash: string;
  payload: {
    previousRevision?: number;
    before?: Partial<T>;
    after?: T;
    patch?: Record<string, unknown>;
  };
}
```

Create `packages/core/src/events/factory.ts`:
```ts
import { CanonicalContext } from '../model/types.js';
import { generateUlid } from '../identity/ulid.js';
import { computeContentHash } from '../identity/hash.js';
import { ContextEvent, EventOperation } from './types.js';

export interface CreateEventOptions {
  operation: EventOperation;
  context: CanonicalContext;
  previousContext?: CanonicalContext;
  patch?: Record<string, unknown>;
  origin?: string;
  cursor?: string;
}

export function createContextEvent(opts: CreateEventOptions): ContextEvent {
  const hash = opts.context.provenance?.contentHash ?? computeContentHash(opts.context.content.text ?? {});
  return {
    eventId: generateUlid(),
    namespace: opts.context.namespace,
    objectId: opts.context.id,
    operation: opts.operation,
    version: opts.context.version.revision,
    origin: opts.origin ?? 'local-node',
    timestamp: new Date().toISOString(),
    checkpointCursor: opts.cursor,
    contentHash: hash,
    payload: {
      previousRevision: opts.previousContext?.version.revision,
      before: opts.previousContext,
      after: opts.context,
      patch: opts.patch,
    },
  };
}
```

Update `packages/core/src/index.ts`:
```ts
export * from './events/types.js';
export * from './events/factory.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): implement normalized ContextEvent types and factory"
```

---

### Task 2: `EventBackend` SPI & `InMemoryEventBackend` in `@opencontext/provider-sdk`

**Files:**
- Create: `packages/provider-sdk/src/events/spi.ts`
- Create: `packages/provider-sdk/src/events/memory-event-backend.ts`
- Create: `packages/provider-sdk/src/events/conformance.ts`
- Modify: `packages/provider-sdk/src/index.ts`
- Test: `packages/provider-sdk/tests/memory-event-backend.test.ts`

**Interfaces:**
- Produces: `EventBackend`, `EventPublishAck`, `ConsumerOptions`, `InMemoryEventBackend`, `runEventBackendConformanceSuite()`.

- [ ] **Step 1: Write failing conformance test for `InMemoryEventBackend`**

Create `packages/provider-sdk/tests/memory-event-backend.test.ts`:
```ts
import { describe } from 'vitest';
import { InMemoryEventBackend } from '../src/events/memory-event-backend.js';
import { runEventBackendConformanceSuite } from '../src/events/conformance.js';

describe('InMemoryEventBackend', () => {
  runEventBackendConformanceSuite('InMemoryEventBackend', {
    create: async () => new InMemoryEventBackend(),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/provider-sdk/tests/memory-event-backend.test.ts`
Expected: FAIL with missing modules

- [ ] **Step 3: Implement `EventBackend` SPI, Conformance Suite, and `InMemoryEventBackend`**

Create `packages/provider-sdk/src/events/spi.ts`:
```ts
import type { ContextEvent } from '@opencontext/core';

export interface EventPublishAck {
  sequenceNumber: bigint;
  cursor: string;
  publishedAt: string;
}

export interface ConsumerOptions {
  consumerGroup: string;
  namespace: string;
  startCursor?: string;
  deliveryPolicy?: 'all' | 'new' | 'from_cursor';
  ackWaitMs?: number;
}

export interface StreamItem {
  event: ContextEvent;
  cursor: string;
  ack(): Promise<void>;
  nack(): Promise<void>;
}

export interface EventBackend {
  readonly id: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<void>;

  publish(event: ContextEvent): Promise<EventPublishAck>;
  subscribe(opts: ConsumerOptions): AsyncIterable<StreamItem>;
}
```

Create `packages/provider-sdk/src/events/conformance.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EventBackend } from './spi.js';
import { createCanonicalContext, createContextEvent } from '@opencontext/core';

export interface EventBackendHarness {
  create(): Promise<EventBackend>;
  cleanup?(): Promise<void>;
}

export function runEventBackendConformanceSuite(name: string, harness: EventBackendHarness): void {
  describe(`${name} - EventBackend Conformance`, () => {
    let backend: EventBackend;

    beforeEach(async () => {
      backend = await harness.create();
      await backend.connect();
    });

    afterEach(async () => {
      await backend.disconnect();
      if (harness.cleanup) await harness.cleanup();
    });

    it('publishes and consumes events within a namespace', async () => {
      const ctx = createCanonicalContext({ content: { text: 'Test event' }, namespace: 'ns_test' });
      const event = createContextEvent({ operation: 'INSERT', context: ctx });

      const ack = await backend.publish(event);
      expect(ack.sequenceNumber).toBeGreaterThanOrEqual(1n);
      expect(ack.cursor).toBeTruthy();

      const stream = backend.subscribe({ consumerGroup: 'grp_1', namespace: 'ns_test', deliveryPolicy: 'all' });
      const iterator = stream[Symbol.asyncIterator]();
      const next = await iterator.next();

      expect(next.done).toBe(false);
      expect(next.value.event.objectId).toBe(ctx.id);
      expect(next.value.cursor).toBe(ack.cursor);
      await next.value.ack();
    });
  });
}
```

Create `packages/provider-sdk/src/events/memory-event-backend.ts`:
```ts
import type { ContextEvent } from '@opencontext/core';
import type { EventBackend, EventPublishAck, ConsumerOptions, StreamItem } from './spi.js';

interface StoredEvent {
  seq: bigint;
  cursor: string;
  event: ContextEvent;
}

export class InMemoryEventBackend implements EventBackend {
  readonly id = 'memory-event-backend';
  private streams = new Map<string, StoredEvent[]>();
  private globalSeq = 0n;
  private listeners = new Map<string, Set<(item: StoredEvent) => void>>();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.streams.clear();
    this.listeners.clear();
  }
  async ping(): Promise<void> {}

  async publish(event: ContextEvent): Promise<EventPublishAck> {
    this.globalSeq++;
    const seq = this.globalSeq;
    const cursor = `cur_${seq}`;
    const stored: StoredEvent = { seq, cursor, event: { ...event, checkpointCursor: cursor } };

    let stream = this.streams.get(event.namespace);
    if (!stream) {
      stream = [];
      this.streams.set(event.namespace, stream);
    }
    stream.push(stored);

    const activeListeners = this.listeners.get(event.namespace);
    if (activeListeners) {
      for (const listener of activeListeners) {
        listener(stored);
      }
    }

    return {
      sequenceNumber: seq,
      cursor,
      publishedAt: new Date().toISOString(),
    };
  }

  async *subscribe(opts: ConsumerOptions): AsyncIterable<StreamItem> {
    const stream = this.streams.get(opts.namespace) || [];
    let startIndex = 0;

    if (opts.deliveryPolicy === 'new') {
      startIndex = stream.length;
    } else if (opts.startCursor) {
      const idx = stream.findIndex((s) => s.cursor === opts.startCursor);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }

    // Yield historical events
    for (let i = startIndex; i < stream.length; i++) {
      const s = stream[i];
      yield {
        event: s.event,
        cursor: s.cursor,
        ack: async () => {},
        nack: async () => {},
      };
    }

    // Yield real-time events
    const queue: StoredEvent[] = [];
    let notify: (() => void) | null = null;

    const listener = (item: StoredEvent) => {
      queue.push(item);
      if (notify) {
        notify();
        notify = null;
      }
    };

    let set = this.listeners.get(opts.namespace);
    if (!set) {
      set = new Set();
      this.listeners.set(opts.namespace, set);
    }
    set.add(listener);

    try {
      while (true) {
        while (queue.length > 0) {
          const item = queue.shift()!;
          yield {
            event: item.event,
            cursor: item.cursor,
            ack: async () => {},
            nack: async () => {},
          };
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    } finally {
      set.delete(listener);
    }
  }
}
```

Update `packages/provider-sdk/src/index.ts`:
```ts
export * from './events/spi.js';
export * from './events/memory-event-backend.js';
export * from './events/conformance.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/provider-sdk/tests/memory-event-backend.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/provider-sdk
git commit -m "feat(provider-sdk): implement EventBackend SPI and InMemoryEventBackend"
```

---

### Task 3: Persistent `SqliteEventLog` in `@opencontext/provider-sdk`

**Files:**
- Create: `packages/provider-sdk/src/events/sqlite-event-log.ts`
- Modify: `packages/provider-sdk/src/index.ts`
- Test: `packages/provider-sdk/tests/sqlite-event-log.test.ts`

**Interfaces:**
- Produces: `SqliteEventLog` implementing `EventBackend`.

- [ ] **Step 1: Write failing conformance test for `SqliteEventLog`**

Create `packages/provider-sdk/tests/sqlite-event-log.test.ts`:
```ts
import { describe } from 'vitest';
import sqlite3 from 'sqlite3';
import { SqliteEventLog } from '../src/events/sqlite-event-log.js';
import { runEventBackendConformanceSuite } from '../src/events/conformance.js';

describe('SqliteEventLog', () => {
  let db: sqlite3.Database;

  runEventBackendConformanceSuite('SqliteEventLog', {
    create: async () => {
      db = new sqlite3.Database(':memory:');
      return new SqliteEventLog(db);
    },
    cleanup: async () => {
      if (db) await new Promise<void>((res) => db.close(() => res()));
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/provider-sdk/tests/sqlite-event-log.test.ts`
Expected: FAIL with missing modules

- [ ] **Step 3: Implement `SqliteEventLog`**

Create `packages/provider-sdk/src/events/sqlite-event-log.ts`:
```ts
import sqlite3 from 'sqlite3';
import type { ContextEvent } from '@opencontext/core';
import type { EventBackend, EventPublishAck, ConsumerOptions, StreamItem } from './spi.js';

export class SqliteEventLog implements EventBackend {
  readonly id = 'sqlite-event-log';
  private pollIntervalMs = 50;

  constructor(private readonly db: sqlite3.Database) {}

  private query(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
  }

  private exec(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  async connect(): Promise<void> {
    await this.exec(`
      CREATE TABLE IF NOT EXISTS context_events (
        sequence_num INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        object_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        version INTEGER NOT NULL,
        origin TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_ns_seq ON context_events(namespace, sequence_num);
    `);
  }

  async disconnect(): Promise<void> {}
  async ping(): Promise<void> {
    await this.query('SELECT 1');
  }

  async publish(event: ContextEvent): Promise<EventPublishAck> {
    const res = await this.exec(
      `INSERT INTO context_events (event_id, namespace, object_id, operation, version, origin, timestamp, content_hash, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.eventId,
        event.namespace,
        event.objectId,
        event.operation,
        event.version,
        event.origin,
        event.timestamp,
        event.contentHash,
        JSON.stringify(event.payload),
      ],
    );

    const seq = BigInt(res.lastID);
    const cursor = `cur_${seq}`;
    return {
      sequenceNumber: seq,
      cursor,
      publishedAt: new Date().toISOString(),
    };
  }

  async *subscribe(opts: ConsumerOptions): AsyncIterable<StreamItem> {
    let lastSeq = 0n;
    if (opts.startCursor) {
      const match = opts.startCursor.match(/^cur_(\d+)$/);
      if (match) lastSeq = BigInt(match[1]);
    } else if (opts.deliveryPolicy === 'new') {
      const rows = await this.query(
        'SELECT MAX(sequence_num) as maxSeq FROM context_events WHERE namespace = ?',
        [opts.namespace],
      );
      lastSeq = rows[0]?.maxSeq ? BigInt(rows[0].maxSeq) : 0n;
    }

    let running = true;
    while (running) {
      const rows = await this.query(
        `SELECT * FROM context_events WHERE namespace = ? AND sequence_num > ? ORDER BY sequence_num ASC LIMIT 100`,
        [opts.namespace, Number(lastSeq)],
      );

      for (const row of rows) {
        lastSeq = BigInt(row.sequence_num);
        const event: ContextEvent = {
          eventId: row.event_id,
          namespace: row.namespace,
          objectId: row.object_id,
          operation: row.operation,
          version: Number(row.version),
          origin: row.origin,
          timestamp: row.timestamp,
          checkpointCursor: `cur_${row.sequence_num}`,
          contentHash: row.content_hash,
          payload: JSON.parse(row.payload_json),
        };

        yield {
          event,
          cursor: `cur_${row.sequence_num}`,
          ack: async () => {},
          nack: async () => {},
        };
      }

      if (rows.length === 0) {
        await new Promise((res) => setTimeout(res, this.pollIntervalMs));
      }
    }
  }
}
```

Update `packages/provider-sdk/src/index.ts`:
```ts
export * from './events/sqlite-event-log.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/provider-sdk/tests/sqlite-event-log.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/provider-sdk
git commit -m "feat(provider-sdk): implement persistent SqliteEventLog"
```

---

### Task 4: Durable Subscription Manager & Crash Recovery in `@opencontext/core`

**Files:**
- Create: `packages/core/src/subscriptions/types.ts`
- Create: `packages/core/src/subscriptions/manager.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/subscription-manager.test.ts`

**Interfaces:**
- Produces: `DurableSubscription`, `SubscriptionManager`, `subscribe()`, `ack()`, `resumeFromCheckpoint()`.

- [ ] **Step 1: Write failing test for durable subscription filter matching and ACK checkpointing**

Create `packages/core/tests/subscription-manager.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { SubscriptionManager } from '../src/subscriptions/manager.js';
import { createCanonicalContext } from '../src/model/factory.js';
import { createContextEvent } from '../src/events/factory.js';

describe('SubscriptionManager', () => {
  it('registers a durable subscription and matches predicate filters', async () => {
    const manager = new SubscriptionManager();
    const sub = await manager.registerSubscription({
      namespace: 'org_test',
      subscriberEndpoint: 'ws://client_1',
      predicate: {
        types: ['decision'],
        scopes: ['project:zorp'],
      },
    });

    expect(sub.subscriptionId).toHaveLength(26);
    expect(sub.lastAcknowledgedCursor).toBe('');

    // Matching event
    const ctxMatch = createCanonicalContext({
      type: 'decision',
      scope: 'project:zorp',
      namespace: 'org_test',
      content: { text: 'Approved' },
    });
    const eventMatch = createContextEvent({ operation: 'INSERT', context: ctxMatch, cursor: 'cur_101' });
    expect(manager.matches(sub, eventMatch)).toBe(true);

    // Non-matching event (different type)
    const ctxNoMatch = createCanonicalContext({
      type: 'fact',
      scope: 'project:zorp',
      namespace: 'org_test',
      content: { text: 'Note' },
    });
    const eventNoMatch = createContextEvent({ operation: 'INSERT', context: ctxNoMatch, cursor: 'cur_102' });
    expect(manager.matches(sub, eventNoMatch)).toBe(false);

    // Commit ACK
    await manager.ack(sub.subscriptionId, 'cur_101');
    const updatedSub = await manager.getSubscription(sub.subscriptionId);
    expect(updatedSub?.lastAcknowledgedCursor).toBe('cur_101');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/subscription-manager.test.ts`
Expected: FAIL with missing modules

- [ ] **Step 3: Implement SubscriptionManager**

Create `packages/core/src/subscriptions/types.ts`:
```ts
import type { EventOperation } from '../events/types.js';

export interface SubscriptionPredicate {
  scopes?: string[];
  types?: string[];
  operations?: EventOperation[];
}

export interface DurableSubscription {
  subscriptionId: string;
  namespace: string;
  subscriberEndpoint: string;
  predicate: SubscriptionPredicate;
  lastAcknowledgedCursor: string;
  deliveryPolicy: 'at_least_once' | 'fire_and_forget';
  createdAt: string;
  updatedAt: string;
}

export interface RegisterSubscriptionOptions {
  namespace: string;
  subscriberEndpoint: string;
  predicate?: SubscriptionPredicate;
  deliveryPolicy?: 'at_least_once' | 'fire_and_forget';
}
```

Create `packages/core/src/subscriptions/manager.ts`:
```ts
import { generateUlid } from '../identity/ulid.js';
import type { ContextEvent } from '../events/types.js';
import type { DurableSubscription, RegisterSubscriptionOptions } from './types.js';

export class SubscriptionManager {
  private subscriptions = new Map<string, DurableSubscription>();

  async registerSubscription(opts: RegisterSubscriptionOptions): Promise<DurableSubscription> {
    const now = new Date().toISOString();
    const sub: DurableSubscription = {
      subscriptionId: generateUlid(),
      namespace: opts.namespace,
      subscriberEndpoint: opts.subscriberEndpoint,
      predicate: opts.predicate ?? {},
      lastAcknowledgedCursor: '',
      deliveryPolicy: opts.deliveryPolicy ?? 'at_least_once',
      createdAt: now,
      updatedAt: now,
    };
    this.subscriptions.set(sub.subscriptionId, sub);
    return sub;
  }

  async getSubscription(subscriptionId: string): Promise<DurableSubscription | undefined> {
    return this.subscriptions.get(subscriptionId);
  }

  async ack(subscriptionId: string, cursor: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      sub.lastAcknowledgedCursor = cursor;
      sub.updatedAt = new Date().toISOString();
    }
  }

  async unsubscribe(subscriptionId: string): Promise<boolean> {
    return this.subscriptions.delete(subscriptionId);
  }

  matches(sub: DurableSubscription, event: ContextEvent): boolean {
    if (sub.namespace !== event.namespace) return false;

    const pred = sub.predicate;
    if (pred.operations && pred.operations.length > 0) {
      if (!pred.operations.includes(event.operation)) return false;
    }

    const context = event.payload.after;
    if (context) {
      if (pred.scopes && pred.scopes.length > 0) {
        if (!pred.scopes.includes(context.scope)) return false;
      }
      if (pred.types && pred.types.length > 0) {
        if (!pred.types.includes(context.type)) return false;
      }
    }

    return true;
  }
}
```

Update `packages/core/src/index.ts`:
```ts
export * from './subscriptions/types.js';
export * from './subscriptions/manager.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/subscription-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): implement DurableSubscription manager and filter predicate matcher"
```

---

### Task 5: Reactive ContextStore Outbox Interceptor in `@opencontext/provider-sdk`

**Files:**
- Create: `packages/provider-sdk/src/events/outbox-interceptor.ts`
- Modify: `packages/provider-sdk/src/index.ts`
- Test: `packages/provider-sdk/tests/reactive-store.test.ts`

**Interfaces:**
- Produces: `ReactiveContextStore` wrapper wrapping any `ContextStore` to emit `ContextEvent` records on mutations to an `EventBackend`.

- [ ] **Step 1: Write failing test for `ReactiveContextStore`**

Create `packages/provider-sdk/tests/reactive-store.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MemoryContextStore } from '../src/base/memory-store.js';
import { InMemoryEventBackend } from '../src/events/memory-event-backend.js';
import { ReactiveContextStore } from '../src/events/outbox-interceptor.js';
import { createCanonicalContext } from '@opencontext/core';

describe('ReactiveContextStore Interceptor', () => {
  it('automatically publishes ContextEvent on put, update, and delete', async () => {
    const rawStore = new MemoryContextStore();
    const eventBackend = new InMemoryEventBackend();
    const reactiveStore = new ReactiveContextStore(rawStore, eventBackend, 'test-node');

    await reactiveStore.connect();

    const ctx = createCanonicalContext({
      content: { text: 'Reactive context mutation' },
      type: 'decision',
      scope: 'project:zorp',
      namespace: 'org_reactive',
    });

    await reactiveStore.put(ctx);

    const stream = eventBackend.subscribe({
      consumerGroup: 'sub_grp',
      namespace: 'org_reactive',
      deliveryPolicy: 'all',
    });
    const iter = stream[Symbol.asyncIterator]();
    const next = await iter.next();

    expect(next.value.event.operation).toBe('INSERT');
    expect(next.value.event.objectId).toBe(ctx.id);
    expect(next.value.event.origin).toBe('test-node');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/provider-sdk/tests/reactive-store.test.ts`
Expected: FAIL with missing modules

- [ ] **Step 3: Implement `ReactiveContextStore`**

Create `packages/provider-sdk/src/events/outbox-interceptor.ts`:
```ts
import type { CanonicalContext, ContextId, NamespaceId } from '@opencontext/core';
import { createContextEvent } from '@opencontext/core';
import type { ContextStore, ContextQuery, ContextBatchMutation } from '../spi.js';
import type { EventBackend } from './spi.js';

export class ReactiveContextStore implements ContextStore {
  readonly id: string;
  readonly capabilities: ContextStore['capabilities'];

  constructor(
    private readonly inner: ContextStore,
    private readonly eventBackend: EventBackend,
    private readonly nodeId = 'local-node',
  ) {
    this.id = `reactive:${inner.id}`;
    this.capabilities = inner.capabilities;
  }

  async connect(): Promise<void> {
    await this.inner.connect();
    await this.eventBackend.connect();
  }

  async disconnect(): Promise<void> {
    await this.inner.disconnect();
    await this.eventBackend.disconnect();
  }

  async ping(): Promise<void> {
    await this.inner.ping();
    await this.eventBackend.ping();
  }

  async put(context: CanonicalContext): Promise<CanonicalContext> {
    const saved = await this.inner.put(context);
    const event = createContextEvent({
      operation: 'INSERT',
      context: saved,
      origin: this.nodeId,
    });
    await this.eventBackend.publish(event);
    return saved;
  }

  async get(id: ContextId, namespace?: NamespaceId): Promise<CanonicalContext | undefined> {
    return this.inner.get(id, namespace);
  }

  async query(q: ContextQuery) {
    return this.inner.query(q);
  }

  async update(
    id: ContextId,
    namespace: NamespaceId,
    expectedRevision: number,
    patch: Partial<CanonicalContext>,
  ): Promise<CanonicalContext> {
    const before = await this.inner.get(id, namespace);
    const updated = await this.inner.update(id, namespace, expectedRevision, patch);
    const event = createContextEvent({
      operation: 'UPDATE',
      context: updated,
      previousContext: before,
      patch,
      origin: this.nodeId,
    });
    await this.eventBackend.publish(event);
    return updated;
  }

  async delete(id: ContextId, namespace: NamespaceId = 'default', hard = false): Promise<boolean> {
    const before = await this.inner.get(id, namespace);
    const res = await this.inner.delete(id, namespace, hard);
    if (res && before) {
      const event = createContextEvent({
        operation: hard ? 'DELETE' : 'LIFECYCLE_CHANGE',
        context: { ...before, lifecycle: hard ? before.lifecycle : 'soft_deleted' },
        previousContext: before,
        origin: this.nodeId,
      });
      await this.eventBackend.publish(event);
    }
    return res;
  }

  async batch(mutation: ContextBatchMutation) {
    return this.inner.batch(mutation);
  }
}
```

Update `packages/provider-sdk/src/index.ts`:
```ts
export * from './events/outbox-interceptor.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/provider-sdk/tests/reactive-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/provider-sdk
git commit -m "feat(provider-sdk): implement ReactiveContextStore outbox interceptor"
```

---

### Task 6: Reactive MCP Tools & Server-Sent Events (SSE) Endpoint

**Files:**
- Create: `src/server/sse.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/server.ts`
- Test: `tests/mcp/reactive-tools.test.ts`

**Interfaces:**
- Produces: MCP `subscribe_context` and `ack_event` tools, Express `/api/context/events` SSE channel.

- [ ] **Step 1: Write test for reactive MCP tools**

Create `tests/mcp/reactive-tools.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createServer } from '../../src/mcp/server.js';
import { MemoryContextStore, InMemoryEventBackend, ReactiveContextStore } from '@opencontext/provider-sdk';

describe('Reactive MCP Server Tools', () => {
  let server: any;
  let reactiveStore: ReactiveContextStore;

  beforeEach(async () => {
    const raw = new MemoryContextStore();
    const eventBackend = new InMemoryEventBackend();
    reactiveStore = new ReactiveContextStore(raw, eventBackend);
    await reactiveStore.connect();
    server = await createServer(reactiveStore as any);
  });

  it('exposes subscribe_context and registers a subscription', async () => {
    const res = await server.handleToolCall('subscribe_context', {
      namespace: 'org_agent',
      types: ['decision'],
      scopes: ['project:alpha'],
    });

    expect(res.content[0].text).toContain('Subscription registered');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/reactive-tools.test.ts`
Expected: FAIL on unregistered tool

- [ ] **Step 3: Register reactive tools in MCP server and SSE endpoint in HTTP server**

Update `src/mcp/server.ts` to register `subscribe_context` and `ack_event` tools.

Create `src/server/sse.ts`:
```ts
import type { Request, Response } from 'express';
import type { EventBackend } from '@opencontext/provider-sdk';

export function createSseHandler(eventBackend: EventBackend) {
  return async (req: Request, res: Response) => {
    const namespace = (req.query.namespace as string) || 'default';
    const startCursor = req.query.cursor as string | undefined;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = eventBackend.subscribe({
      consumerGroup: `sse_${Date.now()}`,
      namespace,
      startCursor,
      deliveryPolicy: startCursor ? 'from_cursor' : 'new',
    });

    try {
      for await (const item of stream) {
        res.write(`id: ${item.cursor}\n`);
        res.write(`event: context_event\n`);
        res.write(`data: ${JSON.stringify(item.event)}\n\n`);
      }
    } catch (err) {
      res.end();
    }
  };
}
```

- [ ] **Step 4: Run full test suite to verify 0 regressions**

Run: `npm test`
Expected: All test suites PASS (390+ tests passing).

- [ ] **Step 5: Commit**

```bash
git add src/ tests/mcp/reactive-tools.test.ts
git commit -m "feat(server): wire Reactive MCP subscription tools and SSE event streaming endpoint"
```

---

### Task 7: Full End-to-End Build & Final Verification

**Files:**
- Modify: `package.json`
- Test: All test suites

- [ ] **Step 1: Run full repository build**

Run: `npm run build`
Expected: TypeScript compilation clean with 0 errors.

- [ ] **Step 2: Run all unit and integration tests**

Run: `npm test`
Expected: 100% green test passing status.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "chore: complete Sub-Project 2 Distributed Context Data Plane implementation"
```

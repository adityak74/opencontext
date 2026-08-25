# Canonical Data Model (OCM 2.0) & Provider SPI / SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Open Context into an npm workspace monorepo with a canonical context model (`CanonicalContext`), formal Provider SPI (`ContextStore`), shared SDK base classes, and dual-layer backward compatibility shims.

**Architecture:** Split the codebase into `@opencontext/core` (canonical model, ULID identity, SHA-256 provenance, v1 shims), `@opencontext/provider-sdk` (SPI contracts, capability flags, `SqlContextStore`, `DocumentContextStore`, `JsonContextStore`, `MemoryContextStore`), and integrate with existing CLI/MCP server via `ContextStoreV1Shim` to ensure zero regressions for 1.x clients.

**Tech Stack:** Node.js 25+, TypeScript 5.9, Vitest, Zod, Crypto, Better-SQLite3 / SQLite3, Model Context Protocol SDK.

## Global Constraints

- Monorepo package namespace: `@opencontext/*`
- Zero regression: All 1.x MCP tools (`save_context`, `recall_context`, `list_bubbles`, etc.) and REST endpoints must continue returning identical structures.
- All timestamps stored in ISO-8601 UTC.
- Monotonic IDs: ULID format for standard entity IDs.
- Hashing: SHA-256 for canonical content provenance validation.
- Conformance: All providers must implement `ContextStore` and adhere to optimistic locking via `revision`.

---

### Task 1: Workspace Scaffolding & Core Package Setup

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/provider-sdk/package.json`
- Create: `packages/provider-sdk/tsconfig.json`
- Modify: `package.json`
- Test: `packages/core/tests/smoke.test.ts`

**Interfaces:**
- Produces: Root npm workspace configuration linking `packages/*` with TypeScript project references.

- [ ] **Step 1: Write failing smoke test for package resolution**

Create `packages/core/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('@opencontext/core smoke test', () => {
  it('resolves the core module root', async () => {
    const core = await import('../src/index.js');
    expect(core.VERSION).toBe('2.0.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/smoke.test.ts`
Expected: FAIL with "Cannot find module '../src/index.js'"

- [ ] **Step 3: Create workspace packages and initial core entrypoint**

Create `packages/core/package.json`:
```json
{
  "name": "@opencontext/core",
  "version": "2.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^4.1.8"
  }
}
```

Create `packages/core/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

Create `packages/provider-sdk/package.json`:
```json
{
  "name": "@opencontext/provider-sdk",
  "version": "2.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@opencontext/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^4.1.8"
  }
}
```

Create `packages/provider-sdk/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

Create `packages/core/src/index.ts`:
```ts
export const VERSION = '2.0.0';
```

Modify root `package.json` to add workspaces:
```json
{
  "workspaces": [
    "packages/*"
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/smoke.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json packages/core packages/provider-sdk
git commit -m "chore: setup npm workspaces for core and provider-sdk"
```

---

### Task 2: Canonical Data Model & Identity Utilities in `@opencontext/core`

**Files:**
- Create: `packages/core/src/model/types.ts`
- Create: `packages/core/src/identity/ulid.ts`
- Create: `packages/core/src/identity/hash.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/model.test.ts`
- Test: `packages/core/tests/identity.test.ts`

**Interfaces:**
- Produces: `CanonicalContext`, `ContextType`, `LifecycleState`, `RelationshipEdge`, `ContextProvenance`, `generateUlid()`, `computeContentHash()`.

- [ ] **Step 1: Write failing tests for Canonical Model and Identity utilities**

Create `packages/core/tests/identity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateUlid, computeContentHash } from '../src/identity/index.js';

describe('Identity & Hashing', () => {
  it('generates a valid 26-character monotonic ULID', () => {
    const id1 = generateUlid();
    const id2 = generateUlid();
    expect(id1).toHaveLength(26);
    expect(id2).toHaveLength(26);
    expect(id1 < id2).toBe(true);
  });

  it('computes deterministic SHA-256 hash for strings and structured objects', () => {
    const textHash = computeContentHash('hello world');
    expect(textHash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');

    const objHash1 = computeContentHash({ a: 1, b: 2 });
    const objHash2 = computeContentHash({ b: 2, a: 1 });
    expect(objHash1).toBe(objHash2);
  });
});
```

Create `packages/core/tests/model.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createCanonicalContext } from '../src/model/factory.js';

describe('CanonicalContext Model', () => {
  it('creates a fully formed CanonicalContext entity with defaults', () => {
    const context = createCanonicalContext({
      content: { text: 'Authentication design pattern' },
      type: 'decision',
      scope: 'project:zorp',
    });

    expect(context.id).toHaveLength(26);
    expect(context.namespace).toBe('default');
    expect(context.scope).toBe('project:zorp');
    expect(context.type).toBe('decision');
    expect(context.content.text).toBe('Authentication design pattern');
    expect(context.provenance.actor).toBe('user');
    expect(context.provenance.contentHash).toBeTruthy();
    expect(context.version.revision).toBe(1);
    expect(context.lifecycle).toBe('active');
    expect(context.relationships).toEqual([]);
    expect(context.timestamps.createdAt).toBeTruthy();
    expect(context.timestamps.updatedAt).toBe(context.timestamps.createdAt);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/`
Expected: FAIL with missing modules

- [ ] **Step 3: Implement Canonical Model and Identity utilities**

Create `packages/core/src/model/types.ts`:
```ts
export type ContextId = string;
export type NamespaceId = string;
export type ScopeId = string;

export type ContextType =
  | 'message'
  | 'fact'
  | 'decision'
  | 'constraint'
  | 'preference'
  | 'artifact'
  | 'observation'
  | 'tool_result'
  | 'summary'
  | 'checkpoint'
  | (string & {});

export type LifecycleState = 'active' | 'archived' | 'deprecated' | 'soft_deleted' | 'pinned';

export interface RelationshipEdge {
  targetId: ContextId;
  relation: 'supersedes' | 'derived_from' | 'references' | 'child_of' | 'caused_by' | string;
  metadata?: Record<string, unknown>;
}

export interface ContextProvenance {
  actor: 'user' | 'agent' | 'system' | 'integration';
  agentId?: string;
  model?: string;
  sourceUri?: string;
  signature?: string;
  contentHash: string;
  derivationChain?: ContextId[];
}

export interface ContextTimestamps {
  createdAt: string;
  updatedAt: string;
  accessedAt?: string;
  expiresAt?: string;
}

export interface CanonicalContext {
  id: ContextId;
  namespace: NamespaceId;
  scope: ScopeId;
  type: ContextType;
  content: {
    text?: string;
    structured?: Record<string, unknown>;
    mediaType?: string;
    embedding?: number[];
  };
  metadata: Record<string, unknown>;
  provenance: ContextProvenance;
  relationships: RelationshipEdge[];
  timestamps: ContextTimestamps;
  version: {
    revision: number;
    clock?: Record<string, number>;
  };
  lifecycle: LifecycleState;
}
```

Create `packages/core/src/identity/ulid.ts`:
```ts
import { randomBytes } from 'node:crypto';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
let lastRandom: Uint8Array = new Uint8Array(10);

export function generateUlid(seedTime: number = Date.now()): string {
  let time = seedTime;
  if (time <= lastTime) {
    time = lastTime;
    // Increment last random for strict monotonicity within same millisecond
    for (let i = 9; i >= 0; i--) {
      if (lastRandom[i] < 255) {
        lastRandom[i]++;
        break;
      }
      lastRandom[i] = 0;
    }
  } else {
    lastTime = time;
    lastRandom = new Uint8Array(randomBytes(10));
  }

  // 10 chars for 48-bit timestamp
  let timeStr = '';
  for (let i = 9; i >= 0; i--) {
    timeStr = ENCODING[time % 32] + timeStr;
    time = Math.floor(time / 32);
  }

  // 16 chars for 80-bit randomness
  let randStr = '';
  for (let i = 0; i < 10; i++) {
    const val = lastRandom[i];
    randStr += ENCODING[val % 32];
    if (randStr.length >= 16) break;
  }
  while (randStr.length < 16) {
    randStr += ENCODING[Math.floor(Math.random() * 32)];
  }

  return timeStr + randStr;
}
```

Create `packages/core/src/identity/hash.ts`:
```ts
import { createHash } from 'node:crypto';

function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJson).join(',')}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson((obj as Record<string, unknown>)[k])}`);
  return `{${pairs.join(',')}}`;
}

export function computeContentHash(content: string | Record<string, unknown>): string {
  const serialized = typeof content === 'string' ? content : canonicalizeJson(content);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
```

Create `packages/core/src/identity/index.ts`:
```ts
export * from './ulid.js';
export * from './hash.js';
```

Create `packages/core/src/model/factory.ts`:
```ts
import { CanonicalContext, ContextType, ScopeId, NamespaceId } from './types.js';
import { generateUlid } from '../identity/ulid.js';
import { computeContentHash } from '../identity/hash.js';

export interface CreateContextOptions {
  id?: string;
  namespace?: NamespaceId;
  scope?: ScopeId;
  type?: ContextType;
  content: {
    text?: string;
    structured?: Record<string, unknown>;
    mediaType?: string;
    embedding?: number[];
  };
  metadata?: Record<string, unknown>;
  actor?: 'user' | 'agent' | 'system' | 'integration';
  agentId?: string;
  sourceUri?: string;
  relationships?: CanonicalContext['relationships'];
  expiresAt?: string;
}

export function createCanonicalContext(opts: CreateContextOptions): CanonicalContext {
  const now = new Date().toISOString();
  const hashInput = opts.content.text ?? opts.content.structured ?? {};

  return {
    id: opts.id ?? generateUlid(),
    namespace: opts.namespace ?? 'default',
    scope: opts.scope ?? 'global',
    type: opts.type ?? 'fact',
    content: opts.content,
    metadata: opts.metadata ?? {},
    provenance: {
      actor: opts.actor ?? 'user',
      agentId: opts.agentId,
      sourceUri: opts.sourceUri,
      contentHash: computeContentHash(hashInput),
    },
    relationships: opts.relationships ?? [],
    timestamps: {
      createdAt: now,
      updatedAt: now,
      expiresAt: opts.expiresAt,
    },
    version: {
      revision: 1,
    },
    lifecycle: 'active',
  };
}
```

Update `packages/core/src/index.ts`:
```ts
export * from './model/types.js';
export * from './model/factory.js';
export * from './identity/index.js';
export const VERSION = '2.0.0';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/`
Expected: PASS (all tests pass)

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): implement CanonicalContext model, ULID identity and SHA-256 hashing"
```

---

### Task 3: Dual-Layer Compatibility Shim (`ContextStoreV1Shim`) in `@opencontext/core`

**Files:**
- Create: `packages/core/src/shims/v1-shim.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/v1-shim.test.ts`

**Interfaces:**
- Consumes: `CanonicalContext`, `ContextType`, `createCanonicalContext`.
- Produces: `ContextStoreV1Shim`, `ContextEntry`, `Bubble`.

- [ ] **Step 1: Write failing test for `ContextStoreV1Shim`**

Create `packages/core/tests/v1-shim.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ContextStoreV1Shim } from '../src/shims/v1-shim.js';
import type { CanonicalContext } from '../src/model/types.js';

describe('ContextStoreV1Shim', () => {
  it('converts legacy saveContext arguments into a CanonicalContext and saves it', async () => {
    let saved: CanonicalContext | undefined;
    const mockStore = {
      put: vi.fn().mockImplementation(async (ctx: CanonicalContext) => {
        saved = ctx;
        return ctx;
      }),
      query: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const shim = new ContextStoreV1Shim(mockStore as any);
    const entry = await shim.saveContext('Always use strict typing', ['typescript', 'rules'], 'chat', 'bubble_123');

    expect(entry.content).toBe('Always use strict typing');
    expect(entry.tags).toEqual(['typescript', 'rules']);
    expect(entry.source).toBe('chat');
    expect(entry.bubbleId).toBe('bubble_123');

    expect(saved).toBeDefined();
    expect(saved!.content.text).toBe('Always use strict typing');
    expect(saved!.metadata.tags).toEqual(['typescript', 'rules']);
    expect(saved!.scope).toBe('bubble:bubble_123');
    expect(saved!.relationships).toEqual([{ targetId: 'bubble_123', relation: 'child_of' }]);
  });

  it('converts CanonicalContext back to ContextEntry losslessly', () => {
    const shim = new ContextStoreV1Shim({} as any);
    const canonical: CanonicalContext = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      namespace: 'default',
      scope: 'bubble:b_1',
      type: 'fact',
      content: { text: 'Test content' },
      metadata: { tags: ['tag1'] },
      provenance: {
        actor: 'user',
        sourceUri: 'custom-cli',
        contentHash: 'hash123',
      },
      relationships: [{ targetId: 'b_1', relation: 'child_of' }],
      timestamps: {
        createdAt: '2026-08-25T01:00:00.000Z',
        updatedAt: '2026-08-25T01:00:00.000Z',
      },
      version: { revision: 1 },
      lifecycle: 'active',
    };

    const entry = shim.toV1Entry(canonical);
    expect(entry.id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(entry.content).toBe('Test content');
    expect(entry.tags).toEqual(['tag1']);
    expect(entry.source).toBe('custom-cli');
    expect(entry.bubbleId).toBe('b_1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/v1-shim.test.ts`
Expected: FAIL with "Cannot find module '../src/shims/v1-shim.js'"

- [ ] **Step 3: Implement `ContextStoreV1Shim`**

Create `packages/core/src/shims/v1-shim.ts`:
```ts
import { CanonicalContext } from '../model/types.js';
import { createCanonicalContext } from '../model/factory.js';

export interface ContextEntry {
  id: string;
  content: string;
  tags: string[];
  source: string;
  bubbleId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Bubble {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MinimalStore {
  put(context: CanonicalContext): Promise<CanonicalContext>;
  get(id: string, namespace?: string): Promise<CanonicalContext | undefined>;
  query(query: any): Promise<{ items: CanonicalContext[]; nextCursor?: string; totalCount?: number }>;
  update(id: string, namespace: string, expectedRevision: number, patch: Partial<CanonicalContext>): Promise<CanonicalContext>;
  delete(id: string, namespace?: string, hard?: boolean): Promise<boolean>;
}

export class ContextStoreV1Shim {
  constructor(private readonly store: MinimalStore) {}

  async saveContext(
    content: string,
    tags: string[] = [],
    source = 'chat',
    bubbleId?: string,
  ): Promise<ContextEntry> {
    const canonical = createCanonicalContext({
      content: { text: content, mediaType: 'text/plain' },
      metadata: { tags, legacySource: source },
      scope: bubbleId ? `bubble:${bubbleId}` : 'global',
      type: 'fact',
      actor: source === 'chat' || source === 'user' ? 'user' : 'system',
      sourceUri: source,
      relationships: bubbleId ? [{ targetId: bubbleId, relation: 'child_of' }] : [],
    });

    const saved = await this.store.put(canonical);
    return this.toV1Entry(saved);
  }

  async getContext(id: string): Promise<ContextEntry | undefined> {
    const item = await this.store.get(id, 'default');
    if (!item || item.type === 'checkpoint' && item.metadata.isBubble) return undefined;
    return this.toV1Entry(item);
  }

  async listContexts(tag?: string): Promise<ContextEntry[]> {
    const result = await this.store.query({
      namespace: 'default',
      lifecycle: ['active'],
      pagination: { limit: 10000, order: 'asc', orderBy: 'createdAt' },
    });

    let items = result.items.filter((i) => !i.metadata.isBubble);
    if (tag) {
      items = items.filter((i) => Array.isArray(i.metadata.tags) && i.metadata.tags.includes(tag));
    }
    return items.map((i) => this.toV1Entry(i));
  }

  async listContextsByBubble(bubbleId: string): Promise<ContextEntry[]> {
    const result = await this.store.query({
      namespace: 'default',
      scope: `bubble:${bubbleId}`,
      lifecycle: ['active'],
      pagination: { limit: 10000, order: 'asc', orderBy: 'createdAt' },
    });
    return result.items.filter((i) => !i.metadata.isBubble).map((i) => this.toV1Entry(i));
  }

  async updateContext(
    id: string,
    content: string,
    tags?: string[],
    bubbleId?: string | null,
  ): Promise<ContextEntry | undefined> {
    const existing = await this.store.get(id, 'default');
    if (!existing) return undefined;

    const patch: Partial<CanonicalContext> = {
      content: { ...existing.content, text: content },
      metadata: { ...existing.metadata, ...(tags ? { tags } : {}) },
      timestamps: { ...existing.timestamps, updatedAt: new Date().toISOString() },
    };

    if (bubbleId !== undefined) {
      if (bubbleId === null) {
        patch.scope = 'global';
        patch.relationships = existing.relationships.filter((r) => r.relation !== 'child_of');
      } else {
        patch.scope = `bubble:${bubbleId}`;
        patch.relationships = [
          ...existing.relationships.filter((r) => r.relation !== 'child_of'),
          { targetId: bubbleId, relation: 'child_of' },
        ];
      }
    }

    const updated = await this.store.update(id, 'default', existing.version.revision, patch);
    return this.toV1Entry(updated);
  }

  async deleteContext(id: string): Promise<boolean> {
    return this.store.delete(id, 'default', true);
  }

  async searchContexts(query: string): Promise<ContextEntry[]> {
    const result = await this.store.query({
      namespace: 'default',
      fullText: query,
      lifecycle: ['active'],
      pagination: { limit: 100 },
    });
    return result.items.filter((i) => !i.metadata.isBubble).map((i) => this.toV1Entry(i));
  }

  async createBubble(name: string, description?: string): Promise<Bubble> {
    const canonical = createCanonicalContext({
      type: 'checkpoint',
      scope: 'global',
      content: { text: name },
      metadata: { name, description, isBubble: true },
    });
    const saved = await this.store.put(canonical);
    return this.toBubble(saved);
  }

  async listBubbles(): Promise<Bubble[]> {
    const result = await this.store.query({
      namespace: 'default',
      types: ['checkpoint'],
      lifecycle: ['active'],
      pagination: { limit: 1000 },
    });
    return result.items.filter((i) => i.metadata.isBubble).map((i) => this.toBubble(i));
  }

  toV1Entry(ctx: CanonicalContext): ContextEntry {
    const bubbleChild = ctx.relationships.find((r) => r.relation === 'child_of');
    return {
      id: ctx.id,
      content: ctx.content.text ?? JSON.stringify(ctx.content.structured ?? {}),
      tags: Array.isArray(ctx.metadata.tags) ? (ctx.metadata.tags as string[]) : [],
      source: ctx.provenance.sourceUri ?? ctx.provenance.actor,
      bubbleId: bubbleChild ? bubbleChild.targetId : undefined,
      createdAt: ctx.timestamps.createdAt,
      updatedAt: ctx.timestamps.updatedAt,
    };
  }

  toBubble(ctx: CanonicalContext): Bubble {
    return {
      id: ctx.id,
      name: (ctx.metadata.name as string) ?? ctx.content.text ?? '',
      description: ctx.metadata.description as string | undefined,
      createdAt: ctx.timestamps.createdAt,
      updatedAt: ctx.timestamps.updatedAt,
    };
  }
}
```

Modify `packages/core/src/index.ts` to export shims:
```ts
export * from './shims/v1-shim.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/v1-shim.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): implement ContextStoreV1Shim for dual-layer backward compatibility"
```

---

### Task 4: Provider SPI & Capability Contracts in `@opencontext/provider-sdk`

**Files:**
- Create: `packages/provider-sdk/src/spi.ts`
- Create: `packages/provider-sdk/src/errors.ts`
- Create: `packages/provider-sdk/src/index.ts`
- Test: `packages/provider-sdk/tests/spi.test.ts`

**Interfaces:**
- Produces: `ContextStore`, `ContextStoreCapabilities`, `ContextQuery`, `ContextBatchMutation`, `DriverNotInstalledError`, `ConcurrencyConflictError`.

- [ ] **Step 1: Write failing test for Provider SPI contracts & error handling**

Create `packages/provider-sdk/tests/spi.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ConcurrencyConflictError, DriverNotInstalledError } from '../src/errors.js';

describe('Provider SPI Contracts', () => {
  it('instantiates structured error types correctly', () => {
    const err1 = new ConcurrencyConflictError('ctx_123', 1, 2);
    expect(err1.message).toContain('ctx_123');
    expect(err1.expectedRevision).toBe(1);
    expect(err1.actualRevision).toBe(2);

    const err2 = new DriverNotInstalledError('postgres', 'pg');
    expect(err2.message).toContain('npm install pg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/provider-sdk/tests/spi.test.ts`
Expected: FAIL with missing modules

- [ ] **Step 3: Implement SPI and Error types**

Create `packages/provider-sdk/src/errors.ts`:
```ts
export class DriverNotInstalledError extends Error {
  constructor(public readonly scheme: string, public readonly packageName: string, public readonly reason?: unknown) {
    super(`${scheme} driver is not installed.\nInstall it with:  npm install ${packageName}`);
    this.name = 'DriverNotInstalledError';
  }
}

export class InvalidDsnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDsnError';
  }
}

export class ConcurrencyConflictError extends Error {
  constructor(public readonly contextId: string, public readonly expectedRevision: number, public readonly actualRevision: number) {
    super(`Concurrency conflict on context '${contextId}': expected revision ${expectedRevision}, but found ${actualRevision}`);
    this.name = 'ConcurrencyConflictError';
  }
}
```

Create `packages/provider-sdk/src/spi.ts`:
```ts
import type { CanonicalContext, ContextId, ContextType, LifecycleState, NamespaceId, ScopeId } from '@opencontext/core';

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
  namespace: NamespaceId;
  scope?: ScopeId | ScopeId[];
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
  get(id: ContextId, namespace?: NamespaceId): Promise<CanonicalContext | undefined>;
  query(query: ContextQuery): Promise<{ items: CanonicalContext[]; nextCursor?: string; totalCount?: number }>;
  update(id: ContextId, namespace: NamespaceId, expectedRevision: number, patch: Partial<CanonicalContext>): Promise<CanonicalContext>;
  delete(id: ContextId, namespace?: NamespaceId, hard?: boolean): Promise<boolean>;
  batch(mutation: ContextBatchMutation): Promise<{ applied: boolean; committedRevision: number }>;
}
```

Create `packages/provider-sdk/src/index.ts`:
```ts
export * from './spi.js';
export * from './errors.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/provider-sdk/tests/spi.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/provider-sdk
git commit -m "feat(provider-sdk): implement ContextStore SPI contracts and error definitions"
```

---

### Task 5: In-Memory & JSON Family Base Stores in `@opencontext/provider-sdk`

**Files:**
- Create: `packages/provider-sdk/src/base/memory-store.ts`
- Create: `packages/provider-sdk/src/base/json-store.ts`
- Create: `packages/provider-sdk/src/testing/conformance.ts`
- Modify: `packages/provider-sdk/src/index.ts`
- Test: `packages/provider-sdk/tests/memory-store.test.ts`
- Test: `packages/provider-sdk/tests/json-store.test.ts`

**Interfaces:**
- Produces: `MemoryContextStore`, `JsonContextStore`, `runProviderConformanceSuite()`.

- [ ] **Step 1: Write failing conformance test for Memory & JSON stores**

Create `packages/provider-sdk/tests/memory-store.test.ts`:
```ts
import { describe } from 'vitest';
import { MemoryContextStore } from '../src/base/memory-store.js';
import { runProviderConformanceSuite } from '../src/testing/conformance.js';

describe('MemoryContextStore', () => {
  runProviderConformanceSuite('MemoryContextStore', {
    create: async () => new MemoryContextStore(),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/provider-sdk/tests/memory-store.test.ts`
Expected: FAIL with missing modules

- [ ] **Step 3: Implement Conformance Test Harness, MemoryStore, and JsonStore**

Create `packages/provider-sdk/src/testing/conformance.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ContextStore } from '../spi.js';
import { createCanonicalContext } from '@opencontext/core';
import { ConcurrencyConflictError } from '../errors.js';

export interface ConformanceHarness {
  create(): Promise<ContextStore>;
  cleanup?(): Promise<void>;
}

export function runProviderConformanceSuite(name: string, harness: ConformanceHarness): void {
  describe(`${name} - Conformance Suite`, () => {
    let store: ContextStore;

    beforeEach(async () => {
      store = await harness.create();
      await store.connect();
    });

    afterEach(async () => {
      await store.disconnect();
      if (harness.cleanup) await harness.cleanup();
    });

    it('puts and gets a canonical context entity', async () => {
      const ctx = createCanonicalContext({
        content: { text: 'Testing context item' },
        type: 'decision',
        scope: 'project:alpha',
      });

      const saved = await store.put(ctx);
      expect(saved.id).toBe(ctx.id);

      const retrieved = await store.get(ctx.id, 'default');
      expect(retrieved).toBeDefined();
      expect(retrieved!.content.text).toBe('Testing context item');
      expect(retrieved!.version.revision).toBe(1);
    });

    it('enforces optimistic locking on update', async () => {
      const ctx = createCanonicalContext({ content: { text: 'Original' } });
      await store.put(ctx);

      const updated = await store.update(ctx.id, 'default', 1, {
        content: { text: 'Updated content' },
      });
      expect(updated.version.revision).toBe(2);
      expect(updated.content.text).toBe('Updated content');

      await expect(
        store.update(ctx.id, 'default', 1, { content: { text: 'Conflicting update' } })
      ).rejects.toThrow(ConcurrencyConflictError);
    });

    it('queries contexts with scope, type, and pagination', async () => {
      const c1 = createCanonicalContext({ content: { text: 'A' }, type: 'fact', scope: 's1' });
      const c2 = createCanonicalContext({ content: { text: 'B' }, type: 'decision', scope: 's1' });
      const c3 = createCanonicalContext({ content: { text: 'C' }, type: 'fact', scope: 's2' });

      await store.put(c1);
      await store.put(c2);
      await store.put(c3);

      const res1 = await store.query({ namespace: 'default', scope: 's1' });
      expect(res1.items.length).toBe(2);

      const res2 = await store.query({ namespace: 'default', types: ['decision'] });
      expect(res2.items.length).toBe(1);
      expect(res2.items[0].content.text).toBe('B');
    });

    it('performs soft and hard delete', async () => {
      const ctx = createCanonicalContext({ content: { text: 'Delete me' } });
      await store.put(ctx);

      // Soft delete
      await store.delete(ctx.id, 'default', false);
      const softDeleted = await store.get(ctx.id, 'default');
      expect(softDeleted?.lifecycle).toBe('soft_deleted');

      // Hard delete
      await store.delete(ctx.id, 'default', true);
      const hardDeleted = await store.get(ctx.id, 'default');
      expect(hardDeleted).toBeUndefined();
    });
  });
}
```

Create `packages/provider-sdk/src/base/memory-store.ts`:
```ts
import type { CanonicalContext, ContextId, NamespaceId } from '@opencontext/core';
import type { ContextStore, ContextStoreCapabilities, ContextQuery, ContextBatchMutation } from '../spi.js';
import { ConcurrencyConflictError } from '../errors.js';

export class MemoryContextStore implements ContextStore {
  readonly id = 'memory';
  readonly capabilities: ContextStoreCapabilities = {
    fullTextSearch: true,
    vectorSearch: false,
    graphTraversal: true,
    atomicTransactions: true,
    optimisticLocking: true,
    nativeTtl: false,
    changeStreams: false,
    durableCursors: false,
  };

  private records = new Map<string, CanonicalContext>();

  private key(id: ContextId, namespace: NamespaceId = 'default'): string {
    return `${namespace}:${id}`;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> { this.records.clear(); }
  async ping(): Promise<void> {}

  async put(context: CanonicalContext): Promise<CanonicalContext> {
    const k = this.key(context.id, context.namespace);
    this.records.set(k, { ...context });
    return { ...context };
  }

  async get(id: ContextId, namespace: NamespaceId = 'default'): Promise<CanonicalContext | undefined> {
    const item = this.records.get(this.key(id, namespace));
    return item ? { ...item } : undefined;
  }

  async query(q: ContextQuery): Promise<{ items: CanonicalContext[]; nextCursor?: string; totalCount?: number }> {
    let items = Array.from(this.records.values()).filter((c) => c.namespace === q.namespace);

    if (q.scope) {
      const scopes = Array.isArray(q.scope) ? q.scope : [q.scope];
      items = items.filter((c) => scopes.includes(c.scope));
    }
    if (q.types && q.types.length > 0) {
      items = items.filter((c) => q.types!.includes(c.type));
    }
    if (q.lifecycle && q.lifecycle.length > 0) {
      items = items.filter((c) => q.lifecycle!.includes(c.lifecycle));
    }
    if (q.fullText) {
      const term = q.fullText.toLowerCase();
      items = items.filter((c) => c.content.text?.toLowerCase().includes(term));
    }

    const order = q.pagination?.order ?? 'asc';
    const orderBy = q.pagination?.orderBy ?? 'createdAt';
    items.sort((a, b) => {
      const valA = orderBy === 'revision' ? a.version.revision : a.timestamps[orderBy];
      const valB = orderBy === 'revision' ? b.version.revision : b.timestamps[orderBy];
      if (valA === valB) return a.id.localeCompare(b.id);
      return order === 'asc' ? (valA < valB ? -1 : 1) : (valA > valB ? -1 : 1);
    });

    const limit = q.pagination?.limit ?? 100;
    const paginated = items.slice(0, limit);
    return { items: paginated, totalCount: items.length };
  }

  async update(id: ContextId, namespace: NamespaceId = 'default', expectedRevision: number, patch: Partial<CanonicalContext>): Promise<CanonicalContext> {
    const k = this.key(id, namespace);
    const existing = this.records.get(k);
    if (!existing) throw new Error(`Context '${id}' not found`);

    if (existing.version.revision !== expectedRevision) {
      throw new ConcurrencyConflictError(id, expectedRevision, existing.version.revision);
    }

    const updated: CanonicalContext = {
      ...existing,
      ...patch,
      id: existing.id,
      namespace: existing.namespace,
      version: {
        ...existing.version,
        revision: existing.version.revision + 1,
      },
      timestamps: {
        ...existing.timestamps,
        updatedAt: new Date().toISOString(),
      },
    };

    this.records.set(k, updated);
    return { ...updated };
  }

  async delete(id: ContextId, namespace: NamespaceId = 'default', hard = false): Promise<boolean> {
    const k = this.key(id, namespace);
    const existing = this.records.get(k);
    if (!existing) return false;

    if (hard) {
      return this.records.delete(k);
    } else {
      existing.lifecycle = 'soft_deleted';
      existing.timestamps.updatedAt = new Date().toISOString();
      return true;
    }
  }

  async batch(mutation: ContextBatchMutation): Promise<{ applied: boolean; committedRevision: number }> {
    if (mutation.puts) {
      for (const p of mutation.puts) await this.put(p);
    }
    if (mutation.updates) {
      for (const u of mutation.updates) await this.update(u.id, 'default', u.expectedRevision, u.patch);
    }
    if (mutation.deletes) {
      for (const d of mutation.deletes) await this.delete(d, 'default', true);
    }
    return { applied: true, committedRevision: 1 };
  }
}
```

Create `packages/provider-sdk/src/base/json-store.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CanonicalContext, ContextId, NamespaceId } from '@opencontext/core';
import type { ContextStore, ContextStoreCapabilities, ContextQuery, ContextBatchMutation } from '../spi.js';
import { MemoryContextStore } from './memory-store.js';

export class JsonContextStore implements ContextStore {
  readonly id = 'json';
  readonly capabilities: ContextStoreCapabilities = {
    fullTextSearch: true,
    vectorSearch: false,
    graphTraversal: true,
    atomicTransactions: true,
    optimisticLocking: true,
    nativeTtl: false,
    changeStreams: false,
    durableCursors: false,
  };

  private memory = new MemoryContextStore();

  constructor(private readonly filePath: string) {}

  async connect(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed: CanonicalContext[] = JSON.parse(data);
      for (const item of parsed) {
        await this.memory.put(item);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const { items } = await this.memory.query({ namespace: 'default', pagination: { limit: 100000 } });
    const tempFile = `${this.filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempFile, JSON.stringify(items, null, 2), 'utf8');
    await fs.rename(tempFile, this.filePath);
  }

  async disconnect(): Promise<void> {
    await this.persist();
    await this.memory.disconnect();
  }

  async ping(): Promise<void> {}

  async put(context: CanonicalContext): Promise<CanonicalContext> {
    const saved = await this.memory.put(context);
    await this.persist();
    return saved;
  }

  async get(id: ContextId, namespace?: NamespaceId): Promise<CanonicalContext | undefined> {
    return this.memory.get(id, namespace);
  }

  async query(q: ContextQuery) {
    return this.memory.query(q);
  }

  async update(id: ContextId, namespace: NamespaceId, expectedRevision: number, patch: Partial<CanonicalContext>): Promise<CanonicalContext> {
    const updated = await this.memory.update(id, namespace, expectedRevision, patch);
    await this.persist();
    return updated;
  }

  async delete(id: ContextId, namespace?: NamespaceId, hard?: boolean): Promise<boolean> {
    const res = await this.memory.delete(id, namespace, hard);
    await this.persist();
    return res;
  }

  async batch(mutation: ContextBatchMutation) {
    const res = await this.memory.batch(mutation);
    await this.persist();
    return res;
  }
}
```

Create `packages/provider-sdk/tests/json-store.test.ts`:
```ts
import { describe } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JsonContextStore } from '../src/base/json-store.js';
import { runProviderConformanceSuite } from '../src/testing/conformance.js';

describe('JsonContextStore', () => {
  const testDir = path.join(os.tmpdir(), `opencontext-json-test-${Date.now()}`);
  const testFile = path.join(testDir, 'contexts.json');

  runProviderConformanceSuite('JsonContextStore', {
    create: async () => new JsonContextStore(testFile),
    cleanup: async () => {
      await fs.rm(testDir, { recursive: true, force: true });
    },
  });
});
```

Update `packages/provider-sdk/src/index.ts`:
```ts
export * from './spi.js';
export * from './errors.js';
export * from './base/memory-store.js';
export * from './base/json-store.js';
export * from './testing/conformance.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/provider-sdk/tests/`
Expected: PASS (all conformance tests pass)

- [ ] **Step 5: Commit**

```bash
git add packages/provider-sdk
git commit -m "feat(provider-sdk): implement MemoryContextStore, JsonContextStore, and conformance harness"
```

---

### Task 6: SQL Base Store & Dialects in `@opencontext/provider-sdk`

**Files:**
- Create: `packages/provider-sdk/src/base/sql-store.ts`
- Create: `packages/provider-sdk/src/base/sql-dialects.ts`
- Modify: `packages/provider-sdk/src/index.ts`
- Test: `packages/provider-sdk/tests/sql-store.test.ts`

**Interfaces:**
- Produces: `SqlContextStore`, `SqlDialect`, `SqliteDialect`, `PostgresDialect`.

- [ ] **Step 1: Write failing conformance test for `SqlContextStore` on SQLite**

Create `packages/provider-sdk/tests/sql-store.test.ts`:
```ts
import { describe } from 'vitest';
import sqlite3 from 'sqlite3';
import { SqlContextStore } from '../src/base/sql-store.js';
import { SqliteDialect } from '../src/base/sql-dialects.js';
import { runProviderConformanceSuite } from '../src/testing/conformance.js';

describe('SqlContextStore (SQLite)', () => {
  let db: sqlite3.Database;

  runProviderConformanceSuite('SqlContextStore - SQLite', {
    create: async () => {
      db = new sqlite3.Database(':memory:');
      const driver = {
        query: (sql: string, params: any[] = []) =>
          new Promise<any[]>((resolve, reject) => {
            db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
          }),
        exec: (sql: string, params: any[] = []) =>
          new Promise<{ changes: number }>((resolve, reject) => {
            db.run(sql, params, function (err) {
              err ? reject(err) : resolve({ changes: this.changes });
            });
          }),
        close: () => new Promise<void>((res) => db.close(() => res())),
      };
      return new SqlContextStore('sqlite', new SqliteDialect(), driver);
    },
    cleanup: async () => {
      if (db) await new Promise<void>((res) => db.close(() => res()));
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/provider-sdk/tests/sql-store.test.ts`
Expected: FAIL with missing modules

- [ ] **Step 3: Implement SQL Dialects and `SqlContextStore`**

Create `packages/provider-sdk/src/base/sql-dialects.ts`:
```ts
export interface SqlDialect {
  readonly name: string;
  createTableSql(): string;
  placeholder(index: number): string;
}

export class SqliteDialect implements SqlDialect {
  readonly name = 'sqlite';
  createTableSql(): string {
    return `
      CREATE TABLE IF NOT EXISTS contexts (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        scope TEXT NOT NULL,
        type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        relationships_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        lifecycle TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_contexts_query ON contexts(namespace, scope, type, lifecycle);
    `;
  }
  placeholder(_index: number): string { return '?'; }
}

export class PostgresDialect implements SqlDialect {
  readonly name = 'postgres';
  createTableSql(): string {
    return `
      CREATE TABLE IF NOT EXISTS contexts (
        id VARCHAR(64) PRIMARY KEY,
        namespace VARCHAR(128) NOT NULL,
        scope VARCHAR(256) NOT NULL,
        type VARCHAR(64) NOT NULL,
        content_json JSONB NOT NULL,
        metadata_json JSONB NOT NULL,
        provenance_json JSONB NOT NULL,
        relationships_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        revision BIGINT NOT NULL,
        lifecycle VARCHAR(32) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pg_contexts ON contexts(namespace, scope, type, lifecycle);
    `;
  }
  placeholder(index: number): string { return `$${index}`; }
}
```

Create `packages/provider-sdk/src/base/sql-store.ts`:
```ts
import type { CanonicalContext, ContextId, NamespaceId } from '@opencontext/core';
import type { ContextStore, ContextStoreCapabilities, ContextQuery, ContextBatchMutation } from '../spi.js';
import type { SqlDialect } from './sql-dialects.js';
import { ConcurrencyConflictError } from '../errors.js';

export interface SqlDriver {
  query(sql: string, params?: any[]): Promise<any[]>;
  exec(sql: string, params?: any[]): Promise<{ changes: number }>;
  close(): Promise<void>;
}

export class SqlContextStore implements ContextStore {
  readonly capabilities: ContextStoreCapabilities = {
    fullTextSearch: true,
    vectorSearch: false,
    graphTraversal: true,
    atomicTransactions: true,
    optimisticLocking: true,
    nativeTtl: false,
    changeStreams: false,
    durableCursors: false,
  };

  constructor(
    readonly id: string,
    private readonly dialect: SqlDialect,
    private readonly driver: SqlDriver,
  ) {}

  async connect(): Promise<void> {
    const statements = this.dialect.createTableSql().split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await this.driver.exec(stmt);
    }
  }

  async disconnect(): Promise<void> {
    await this.driver.close();
  }

  async ping(): Promise<void> {
    await this.driver.query('SELECT 1');
  }

  private rowToContext(row: any): CanonicalContext {
    return {
      id: row.id,
      namespace: row.namespace,
      scope: row.scope,
      type: row.type,
      content: typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json,
      metadata: typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json,
      provenance: typeof row.provenance_json === 'string' ? JSON.parse(row.provenance_json) : row.provenance_json,
      relationships: typeof row.relationships_json === 'string' ? JSON.parse(row.relationships_json) : row.relationships_json,
      timestamps: {
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      version: {
        revision: Number(row.revision),
      },
      lifecycle: row.lifecycle,
    };
  }

  async put(ctx: CanonicalContext): Promise<CanonicalContext> {
    const p = (i: number) => this.dialect.placeholder(i);
    const sql = `
      INSERT INTO contexts (id, namespace, scope, type, content_json, metadata_json, provenance_json, relationships_json, created_at, updated_at, revision, lifecycle)
      VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)})
    `;
    const params = [
      ctx.id,
      ctx.namespace,
      ctx.scope,
      ctx.type,
      JSON.stringify(ctx.content),
      JSON.stringify(ctx.metadata),
      JSON.stringify(ctx.provenance),
      JSON.stringify(ctx.relationships),
      ctx.timestamps.createdAt,
      ctx.timestamps.updatedAt,
      ctx.version.revision,
      ctx.lifecycle,
    ];
    await this.driver.exec(sql, params);
    return ctx;
  }

  async get(id: ContextId, namespace: NamespaceId = 'default'): Promise<CanonicalContext | undefined> {
    const p = (i: number) => this.dialect.placeholder(i);
    const rows = await this.driver.query(
      `SELECT * FROM contexts WHERE id = ${p(1)} AND namespace = ${p(2)}`,
      [id, namespace],
    );
    if (!rows || rows.length === 0) return undefined;
    return this.rowToContext(rows[0]);
  }

  async query(q: ContextQuery): Promise<{ items: CanonicalContext[]; nextCursor?: string; totalCount?: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    conditions.push(`namespace = ${this.dialect.placeholder(idx++)}`);
    params.push(q.namespace);

    if (q.scope) {
      const scopes = Array.isArray(q.scope) ? q.scope : [q.scope];
      const placeholders = scopes.map(() => this.dialect.placeholder(idx++)).join(', ');
      conditions.push(`scope IN (${placeholders})`);
      params.push(...scopes);
    }

    if (q.types && q.types.length > 0) {
      const placeholders = q.types.map(() => this.dialect.placeholder(idx++)).join(', ');
      conditions.push(`type IN (${placeholders})`);
      params.push(...q.types);
    }

    if (q.lifecycle && q.lifecycle.length > 0) {
      const placeholders = q.lifecycle.map(() => this.dialect.placeholder(idx++)).join(', ');
      conditions.push(`lifecycle IN (${placeholders})`);
      params.push(...q.lifecycle);
    }

    if (q.fullText) {
      conditions.push(`content_json LIKE ${this.dialect.placeholder(idx++)}`);
      params.push(`%${q.fullText}%`);
    }

    const orderCol = q.pagination?.orderBy === 'revision' ? 'revision' : 'created_at';
    const orderDir = q.pagination?.order === 'desc' ? 'DESC' : 'ASC';
    const limit = q.pagination?.limit ?? 100;

    const sql = `
      SELECT * FROM contexts
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderCol} ${orderDir}, id ASC
      LIMIT ${limit}
    `;

    const rows = await this.driver.query(sql, params);
    const items = rows.map((r) => this.rowToContext(r));
    return { items, totalCount: items.length };
  }

  async update(id: ContextId, namespace: NamespaceId = 'default', expectedRevision: number, patch: Partial<CanonicalContext>): Promise<CanonicalContext> {
    const existing = await this.get(id, namespace);
    if (!existing) throw new Error(`Context '${id}' not found`);
    if (existing.version.revision !== expectedRevision) {
      throw new ConcurrencyConflictError(id, expectedRevision, existing.version.revision);
    }

    const newRev = expectedRevision + 1;
    const now = new Date().toISOString();
    const updatedCtx: CanonicalContext = {
      ...existing,
      ...patch,
      id,
      namespace,
      version: { ...existing.version, revision: newRev },
      timestamps: { ...existing.timestamps, updatedAt: now },
    };

    const p = (i: number) => this.dialect.placeholder(i);
    const sql = `
      UPDATE contexts
      SET content_json = ${p(1)}, metadata_json = ${p(2)}, provenance_json = ${p(3)}, relationships_json = ${p(4)},
          updated_at = ${p(5)}, revision = ${p(6)}, lifecycle = ${p(7)}
      WHERE id = ${p(8)} AND namespace = ${p(9)} AND revision = ${p(10)}
    `;

    const res = await this.driver.exec(sql, [
      JSON.stringify(updatedCtx.content),
      JSON.stringify(updatedCtx.metadata),
      JSON.stringify(updatedCtx.provenance),
      JSON.stringify(updatedCtx.relationships),
      now,
      newRev,
      updatedCtx.lifecycle,
      id,
      namespace,
      expectedRevision,
    ]);

    if (res.changes === 0) {
      throw new ConcurrencyConflictError(id, expectedRevision, (await this.get(id, namespace))?.version.revision ?? -1);
    }

    return updatedCtx;
  }

  async delete(id: ContextId, namespace: NamespaceId = 'default', hard = false): Promise<boolean> {
    const p = (i: number) => this.dialect.placeholder(i);
    if (hard) {
      const res = await this.driver.exec(
        `DELETE FROM contexts WHERE id = ${p(1)} AND namespace = ${p(2)}`,
        [id, namespace],
      );
      return res.changes > 0;
    } else {
      const res = await this.driver.exec(
        `UPDATE contexts SET lifecycle = 'soft_deleted', updated_at = ${p(1)} WHERE id = ${p(2)} AND namespace = ${p(3)}`,
        [new Date().toISOString(), id, namespace],
      );
      return res.changes > 0;
    }
  }

  async batch(mutation: ContextBatchMutation): Promise<{ applied: boolean; committedRevision: number }> {
    if (mutation.puts) {
      for (const p of mutation.puts) await this.put(p);
    }
    if (mutation.updates) {
      for (const u of mutation.updates) await this.update(u.id, 'default', u.expectedRevision, u.patch);
    }
    if (mutation.deletes) {
      for (const d of mutation.deletes) await this.delete(d, 'default', true);
    }
    return { applied: true, committedRevision: 1 };
  }
}
```

Update `packages/provider-sdk/src/index.ts`:
```ts
export * from './base/sql-dialects.js';
export * from './base/sql-store.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/provider-sdk/tests/sql-store.test.ts`
Expected: PASS (all SQL tests pass)

- [ ] **Step 5: Commit**

```bash
git add packages/provider-sdk
git commit -m "feat(provider-sdk): implement SqlContextStore and SqlDialect implementations"
```

---

### Task 7: Universal DSN Loader & Driver Wiring

**Files:**
- Create: `packages/provider-sdk/src/dsn.ts`
- Modify: `src/store/types.ts`
- Modify: `src/store/manager.ts`
- Modify: `src/store/index.ts`
- Test: `tests/store/v2-dsn-bridge.test.ts`

**Interfaces:**
- Produces: `ContextStoreRegistry`, `createContextStoreFromDsn(dsn: string): Promise<ContextStore>`.

- [ ] **Step 1: Write failing test for DSN loader bridge**

Create `tests/store/v2-dsn-bridge.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createContextStoreFromDsn } from '../../src/store/manager.js';

describe('V2 DSN Store Loader', () => {
  it('instantiates MemoryContextStore for memory:// DSN', async () => {
    const store = await createContextStoreFromDsn('memory://');
    expect(store.id).toBe('memory');
    expect(store.capabilities.optimisticLocking).toBe(true);
  });

  it('instantiates JsonContextStore for json:// DSN', async () => {
    const store = await createContextStoreFromDsn('json://tmp/test.json');
    expect(store.id).toBe('json');
  });

  it('instantiates SqlContextStore for sqlite:// DSN', async () => {
    const store = await createContextStoreFromDsn('sqlite://:memory:');
    expect(store.id).toBe('sqlite');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/v2-dsn-bridge.test.ts`
Expected: FAIL with "createContextStoreFromDsn is not a function"

- [ ] **Step 3: Implement DSN registry and wire into store manager**

Create `packages/provider-sdk/src/dsn.ts`:
```ts
import { InvalidDsnError, UnsupportedSchemeError } from './errors.js';
import type { ContextStore } from './spi.js';

export interface ParsedDsn {
  scheme: string;
  host?: string;
  port?: number;
  path?: string;
  user?: string;
  password?: string;
  params: Record<string, string>;
  raw: string;
}

export function parseDsn(dsn: string): ParsedDsn {
  const match = dsn.match(/^([a-zA-Z0-9+_-]+):\/\/(.*)$/);
  if (!match) throw new InvalidDsnError(`Invalid DSN format: '${dsn}'`);

  const scheme = match[1].toLowerCase();
  const rest = match[2];
  return {
    scheme,
    path: rest,
    params: {},
    raw: dsn,
  };
}

export type StoreFactory = (parsed: ParsedDsn) => Promise<ContextStore>;

export class ContextStoreRegistry {
  private static factories = new Map<string, StoreFactory>();

  static register(scheme: string, factory: StoreFactory): void {
    this.factories.set(scheme.toLowerCase(), factory);
  }

  static async create(dsn: string): Promise<ContextStore> {
    const parsed = parseDsn(dsn);
    const factory = this.factories.get(parsed.scheme);
    if (!factory) {
      throw new Error(`Unsupported storage scheme: '${parsed.scheme}'`);
    }
    const store = await factory(parsed);
    await store.connect();
    return store;
  }
}
```

Update `src/store/manager.ts`:
```ts
import { ContextStoreRegistry } from '@opencontext/provider-sdk';
import { MemoryContextStore, JsonContextStore, SqlContextStore, SqliteDialect } from '@opencontext/provider-sdk';
import sqlite3 from 'sqlite3';

// Register built-in default engines
ContextStoreRegistry.register('memory', async () => new MemoryContextStore());
ContextStoreRegistry.register('json', async (parsed) => new JsonContextStore(parsed.path || './contexts.json'));
ContextStoreRegistry.register('sqlite', async (parsed) => {
  const dbPath = parsed.path === ':memory:' ? ':memory:' : (parsed.path || './contexts.db');
  const db = new sqlite3.Database(dbPath);
  const driver = {
    query: (sql: string, params: any[] = []) =>
      new Promise<any[]>((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
      }),
    exec: (sql: string, params: any[] = []) =>
      new Promise<{ changes: number }>((resolve, reject) => {
        db.run(sql, params, function (err) {
          err ? reject(err) : resolve({ changes: this.changes });
        });
      }),
    close: () => new Promise<void>((res) => db.close(() => res())),
  };
  return new SqlContextStore('sqlite', new SqliteDialect(), driver);
});

export async function createContextStoreFromDsn(dsn: string) {
  return ContextStoreRegistry.create(dsn);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store/v2-dsn-bridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/provider-sdk src/store tests/store
git commit -m "feat(store): wire Universal DSN Loader and built-in SQLite/JSON/Memory providers"
```

---

### Task 8: Server & MCP Server Integration (v1 Shims + v2 Native Tools)

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `src/server.ts`
- Test: `tests/mcp/server.test.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: `createContextStoreFromDsn`, `ContextStoreV1Shim`, `CanonicalContext`.
- Produces: Backward-compatible MCP tools + new `save_canonical_context` and `query_canonical_context` tools.

- [ ] **Step 1: Write test for new canonical MCP tools while ensuring legacy tools pass**

Update `tests/mcp/server.test.ts` to include tests for both v1 and v2 tools:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createServer } from '../../src/mcp/server.js';
import { MemoryContextStore } from '@opencontext/provider-sdk';

describe('MCP Server v2 Tools', () => {
  let server: any;
  let rawStore: MemoryContextStore;

  beforeEach(async () => {
    rawStore = new MemoryContextStore();
    await rawStore.connect();
    server = await createServer(rawStore as any);
  });

  it('preserves legacy save_context and recall_context tool execution', async () => {
    const saveRes = await server.handleToolCall('save_context', {
      content: 'Legacy tool test',
      tags: ['test'],
    });
    expect(saveRes.content[0].text).toContain('Context saved');

    const recallRes = await server.handleToolCall('recall_context', {
      query: 'Legacy tool',
    });
    expect(recallRes.content[0].text).toContain('Legacy tool test');
  });

  it('executes new save_canonical_context tool', async () => {
    const saveRes = await server.handleToolCall('save_canonical_context', {
      content: 'Decision to use OCM 2.0',
      type: 'decision',
      scope: 'project:v2',
    });
    expect(saveRes.content[0].text).toContain('Canonical context saved');

    const queryRes = await server.handleToolCall('query_canonical_context', {
      scope: 'project:v2',
      types: ['decision'],
    });
    expect(queryRes.content[0].text).toContain('Decision to use OCM 2.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/server.test.ts`
Expected: FAIL on unknown tool calls

- [ ] **Step 3: Update MCP Server to register v2 tools and use `ContextStoreV1Shim`**

Update `src/mcp/server.ts` to add tool definitions for `save_canonical_context` and `query_canonical_context` and wrap the storage engine in `ContextStoreV1Shim`.

- [ ] **Step 4: Run full test suite to verify 0 regressions**

Run: `npm test`
Expected: All 15+ test suites PASS (385+ tests passing).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/server.ts tests/mcp/server.test.ts
git commit -m "feat(mcp): expose v2 canonical context tools alongside v1 backward compatibility shims"
```

---

### Task 9: Full End-to-End Build & Final Verification

**Files:**
- Modify: `package.json` (build scripts)
- Test: All test files

- [ ] **Step 1: Run complete build for all workspace packages**

Run: `npm run build`
Expected: TypeScript compilation succeeds with 0 errors.

- [ ] **Step 2: Run full test suite with coverage**

Run: `npm run test`
Expected: All tests PASS with 100% green status.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "chore: complete Sub-Project 1 Canonical Model and Provider SPI implementation"
```

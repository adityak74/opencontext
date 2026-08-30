import { describe, it, expect } from 'vitest';
import {
  ConcurrencyConflictError,
  DriverNotInstalledError,
  InvalidDsnError,
} from '../src/index.js';
import type {
  ContextStore,
  ContextStoreCapabilities,
  ContextQuery,
  ContextBatchMutation,
} from '../src/index.js';
import type { CanonicalContext } from '@opencontext/core';

describe('Provider SDK Error Types', () => {
  it('instantiates ConcurrencyConflictError correctly', () => {
    const err = new ConcurrencyConflictError('ctx_123', 1, 2);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConcurrencyConflictError);
    expect(err.name).toBe('ConcurrencyConflictError');
    expect(err.contextId).toBe('ctx_123');
    expect(err.expectedRevision).toBe(1);
    expect(err.actualRevision).toBe(2);
    expect(err.message).toBe(
      "Concurrency conflict on context 'ctx_123': expected revision 1, but found 2"
    );
  });

  it('instantiates DriverNotInstalledError correctly with and without reason', () => {
    const errWithoutReason = new DriverNotInstalledError('postgres', 'pg');
    expect(errWithoutReason).toBeInstanceOf(Error);
    expect(errWithoutReason).toBeInstanceOf(DriverNotInstalledError);
    expect(errWithoutReason.name).toBe('DriverNotInstalledError');
    expect(errWithoutReason.scheme).toBe('postgres');
    expect(errWithoutReason.packageName).toBe('pg');
    expect(errWithoutReason.reason).toBeUndefined();
    expect(errWithoutReason.message).toContain('postgres driver is not installed.');
    expect(errWithoutReason.message).toContain('Install it with:  npm install pg');

    const innerReason = new Error('Cannot find module pg');
    const errWithReason = new DriverNotInstalledError('mongodb', 'mongodb', innerReason);
    expect(errWithReason.scheme).toBe('mongodb');
    expect(errWithReason.packageName).toBe('mongodb');
    expect(errWithReason.reason).toBe(innerReason);
  });

  it('instantiates InvalidDsnError correctly', () => {
    const err = new InvalidDsnError('Invalid DSN: missing protocol');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidDsnError);
    expect(err.name).toBe('InvalidDsnError');
    expect(err.message).toBe('Invalid DSN: missing protocol');
  });
});

describe('Provider SPI Contracts', () => {
  it('allows a class to conform to ContextStore and ContextStoreCapabilities', async () => {
    const mockCapabilities: ContextStoreCapabilities = {
      fullTextSearch: true,
      vectorSearch: true,
      graphTraversal: true,
      atomicTransactions: true,
      optimisticLocking: true,
      nativeTtl: true,
      changeStreams: true,
      durableCursors: true,
    };

    class MockStore implements ContextStore {
      readonly id = 'mock-store';
      readonly capabilities = mockCapabilities;
      private data = new Map<string, CanonicalContext>();

      async connect(): Promise<void> {}
      async disconnect(): Promise<void> {}
      async ping(): Promise<void> {}

      async put(context: CanonicalContext): Promise<CanonicalContext> {
        this.data.set(context.id, context);
        return context;
      }

      async get(id: string, _namespace?: string): Promise<CanonicalContext | undefined> {
        return this.data.get(id);
      }

      async query(query: ContextQuery): Promise<{ items: CanonicalContext[]; nextCursor?: string; totalCount?: number }> {
        let items = Array.from(this.data.values()).filter(
          (ctx) => ctx.namespace === query.namespace
        );

        if (query.scope) {
          const scopes = Array.isArray(query.scope) ? query.scope : [query.scope];
          items = items.filter((ctx) => scopes.includes(ctx.scope));
        }

        if (query.types) {
          items = items.filter((ctx) => query.types!.includes(ctx.type));
        }

        if (query.lifecycle) {
          items = items.filter((ctx) => query.lifecycle!.includes(ctx.lifecycle));
        }

        if (query.pagination?.limit) {
          items = items.slice(0, query.pagination.limit);
        }

        return { items, totalCount: items.length };
      }

      async update(
        id: string,
        _namespace: string,
        expectedRevision: number,
        patch: Partial<CanonicalContext>
      ): Promise<CanonicalContext> {
        const existing = this.data.get(id);
        if (!existing) {
          throw new Error('Not found');
        }
        if (existing.version.revision !== expectedRevision) {
          throw new ConcurrencyConflictError(id, expectedRevision, existing.version.revision);
        }
        const updated: CanonicalContext = {
          ...existing,
          ...patch,
          version: {
            ...existing.version,
            revision: existing.version.revision + 1,
          },
        };
        this.data.set(id, updated);
        return updated;
      }

      async delete(id: string, _namespace?: string, _hard?: boolean): Promise<boolean> {
        return this.data.delete(id);
      }

      async batch(
        mutation: ContextBatchMutation
      ): Promise<{ applied: boolean; committedRevision: number }> {
        if (mutation.puts) {
          for (const item of mutation.puts) {
            this.data.set(item.id, item);
          }
        }
        if (mutation.updates) {
          for (const u of mutation.updates) {
            await this.update(u.id, '', u.expectedRevision, u.patch);
          }
        }
        if (mutation.deletes) {
          for (const id of mutation.deletes) {
            this.data.delete(id);
          }
        }
        return { applied: true, committedRevision: 1 };
      }
    }

    const store: ContextStore = new MockStore();
    expect(store.id).toBe('mock-store');
    expect(store.capabilities.optimisticLocking).toBe(true);
    expect(store.capabilities.vectorSearch).toBe(true);

    await store.connect();
    await store.ping();

    const sampleContext: CanonicalContext = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      namespace: 'default',
      scope: 'project:alpha',
      type: 'decision',
      content: { text: 'Use ULID for IDs' },
      metadata: {},
      provenance: {
        actor: 'agent',
        contentHash: 'abc123hash',
      },
      relationships: [],
      timestamps: {
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
      version: { revision: 1 },
      lifecycle: 'active',
    };

    const saved = await store.put(sampleContext);
    expect(saved.id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');

    const fetched = await store.get('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(fetched).toEqual(sampleContext);

    // ContextQuery with rich filters
    const query: ContextQuery = {
      namespace: 'default',
      scope: ['project:alpha'],
      types: ['decision'],
      lifecycle: ['active'],
      filter: { 'metadata.priority': 'high' },
      fullText: 'ULID',
      vector: {
        embedding: [0.1, 0.2, 0.3],
        topK: 5,
        minSimilarity: 0.8,
      },
      relationships: {
        relatedTo: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        relation: 'references',
        depth: 2,
      },
      pagination: { limit: 10, cursor: 'cur_0', order: 'desc', orderBy: 'createdAt' },
    };

    const queryResult = await store.query(query);
    expect(queryResult.items).toHaveLength(1);
    expect(queryResult.totalCount).toBe(1);

    // Update with correct revision
    const updated = await store.update('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'default', 1, {
      content: { text: 'Use ULID for monotonic IDs' },
    });
    expect(updated.version.revision).toBe(2);
    expect(updated.content.text).toBe('Use ULID for monotonic IDs');

    // Update with wrong revision should throw ConcurrencyConflictError
    await expect(
      store.update('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'default', 1, {
        content: { text: 'Stale update' },
      })
    ).rejects.toThrow(ConcurrencyConflictError);

    // Batch mutation with updates and puts
    const ctx2: CanonicalContext = {
      ...sampleContext,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      version: { revision: 1 },
    };

    const batchPutResult = await store.batch({
      puts: [ctx2],
      updates: [
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          expectedRevision: 2,
          patch: { metadata: { updatedInBatch: true } },
        },
      ],
    });
    expect(batchPutResult.applied).toBe(true);

    const fetchedCtx2 = await store.get('01ARZ3NDEKTSV4RRFFQ69G5FAW');
    expect(fetchedCtx2?.id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAW');

    const fetchedCtx1 = await store.get('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(fetchedCtx1?.metadata).toEqual({ updatedInBatch: true });
    expect(fetchedCtx1?.version.revision).toBe(3);

    // Batch mutation with deletes
    const batchResult = await store.batch({
      deletes: ['01ARZ3NDEKTSV4RRFFQ69G5FAV', '01ARZ3NDEKTSV4RRFFQ69G5FAW'],
    });
    expect(batchResult.applied).toBe(true);
    expect(await store.get('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBeUndefined();
    expect(await store.get('01ARZ3NDEKTSV4RRFFQ69G5FAW')).toBeUndefined();

    await store.disconnect();
  });
});

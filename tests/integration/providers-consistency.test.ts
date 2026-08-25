import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  createCanonicalContext,
  type CanonicalContext,
  type ContextType,
} from '@opencontext/core';
import {
  MemoryContextStore,
  JsonContextStore,
  SqlContextStore,
  SqliteDialect,
  ConcurrencyConflictError,
  type ContextStore,
} from '@opencontext/provider-sdk';

interface ProviderFactory {
  name: string;
  create: () => Promise<{ store: ContextStore; cleanup: () => Promise<void> }>;
}

const providers: ProviderFactory[] = [
  {
    name: 'MemoryContextStore',
    create: async () => {
      const store = new MemoryContextStore();
      return {
        store,
        cleanup: async () => {
          await store.disconnect();
        },
      };
    },
  },
  {
    name: 'JsonContextStore',
    create: async () => {
      const dir = join(tmpdir(), `opencontext-json-integration-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, 'contexts.json');
      const store = new JsonContextStore(filePath);
      return {
        store,
        cleanup: async () => {
          await store.disconnect();
          if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      };
    },
  },
  {
    name: 'SqlContextStore (SQLite)',
    create: async () => {
      const dir = join(tmpdir(), `opencontext-sqlite-integration-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      const dbPath = join(dir, 'contexts.db');
      const db = new DatabaseSync(dbPath);
      const driver = {
        query: async (sql: string, params: any[] = []) => {
          const stmt = db.prepare(sql);
          return stmt.all(...params);
        },
        exec: async (sql: string, params: any[] = []) => {
          const stmt = db.prepare(sql);
          const res = stmt.run(...params);
          return { changes: Number(res.changes) };
        },
        close: async () => {
          try {
            db.close();
          } catch {}
        },
      };
      const store = new SqlContextStore('sqlite-int', new SqliteDialect(), driver);
      return {
        store,
        cleanup: async () => {
          await store.disconnect();
          if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      };
    },
  },
];

describe('Cross-Provider Integration & Consistency Test Suite', () => {
  for (const provider of providers) {
    describe(`Provider: ${provider.name}`, () => {
      let store: ContextStore;
      let cleanup: () => Promise<void>;

      beforeEach(async () => {
        const instance = await provider.create();
        store = instance.store;
        cleanup = instance.cleanup;
        await store.connect();
      });

      afterEach(async () => {
        await cleanup();
      });

      it('connects, pings, and disconnects cleanly', async () => {
        await expect(store.ping()).resolves.toBeUndefined();
      });

      it('maintains full model fidelity on put and get', async () => {
        const ctx = createCanonicalContext({
          content: {
            text: 'Architecture decision on storage provider SPI',
            structured: { key: 'value', numbers: [1, 2, 3], nested: { ok: true } },
            mediaType: 'application/json',
          },
          type: 'decision',
          scope: 'project:architecture',
          namespace: 'custom-ns',
          metadata: { priority: 'high', tags: ['storage', 'spi', 'v2'] },
          relationships: [
            { targetId: 'ctx_target_123', relation: 'supersedes', metadata: { reason: 'v1 deprecation' } },
          ],
          actor: 'agent',
          agentId: 'agent_architect_01',
          sourceUri: 'file:///specs/spi-design.md',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });

        const saved = await store.put(ctx);
        expect(saved.id).toBe(ctx.id);
        expect(saved.version.revision).toBe(1);

        const retrieved = await store.get(ctx.id, 'custom-ns');
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(ctx.id);
        expect(retrieved!.namespace).toBe('custom-ns');
        expect(retrieved!.scope).toBe('project:architecture');
        expect(retrieved!.type).toBe('decision');
        expect(retrieved!.content.text).toBe('Architecture decision on storage provider SPI');
        expect(retrieved!.content.structured).toEqual({ key: 'value', numbers: [1, 2, 3], nested: { ok: true } });
        expect(retrieved!.content.mediaType).toBe('application/json');
        expect(retrieved!.metadata).toEqual({ priority: 'high', tags: ['storage', 'spi', 'v2'] });
        expect(retrieved!.provenance.actor).toBe('agent');
        expect(retrieved!.provenance.agentId).toBe('agent_architect_01');
        expect(retrieved!.provenance.sourceUri).toBe('file:///specs/spi-design.md');
        expect(retrieved!.relationships).toHaveLength(1);
        expect(retrieved!.relationships[0].targetId).toBe('ctx_target_123');
        expect(retrieved!.relationships[0].relation).toBe('supersedes');
        expect(retrieved!.relationships[0].metadata).toEqual({ reason: 'v1 deprecation' });
        expect(retrieved!.timestamps.createdAt).toBe(ctx.timestamps.createdAt);
        expect(retrieved!.timestamps.updatedAt).toBe(ctx.timestamps.updatedAt);
        expect(retrieved!.timestamps.expiresAt).toBe(ctx.timestamps.expiresAt);
        expect(retrieved!.version.revision).toBe(1);
        expect(retrieved!.lifecycle).toBe('active');
      });

      it('enforces optimistic concurrency control across updates', async () => {
        const ctx = createCanonicalContext({
          content: { text: 'Base version' },
          scope: 'project:concurrency',
        });
        await store.put(ctx);

        // Update revision 1 -> 2
        const updated1 = await store.update(ctx.id, 'default', 1, {
          content: { text: 'Second revision' },
        });
        expect(updated1.version.revision).toBe(2);
        expect(updated1.content.text).toBe('Second revision');

        // Conflicting update with stale revision 1 must throw ConcurrencyConflictError
        await expect(
          store.update(ctx.id, 'default', 1, {
            content: { text: 'Conflicting stale update' },
          })
        ).rejects.toThrow(ConcurrencyConflictError);

        // Update revision 2 -> 3
        const updated2 = await store.update(ctx.id, 'default', 2, {
          content: { text: 'Third revision' },
        });
        expect(updated2.version.revision).toBe(3);
        expect(updated2.content.text).toBe('Third revision');
      });

      it('consistently performs soft and hard deletion', async () => {
        const ctx = createCanonicalContext({
          content: { text: 'Context to be deleted' },
          scope: 'project:deletion',
        });
        await store.put(ctx);

        // Soft delete
        const softRes = await store.delete(ctx.id, 'default', false);
        expect(softRes).toBe(true);

        const softItem = await store.get(ctx.id, 'default');
        expect(softItem).toBeDefined();
        expect(softItem!.lifecycle).toBe('soft_deleted');

        // Hard delete
        const hardRes = await store.delete(ctx.id, 'default', true);
        expect(hardRes).toBe(true);

        const hardItem = await store.get(ctx.id, 'default');
        expect(hardItem).toBeUndefined();

        // Repeated delete returns false
        const repeatRes = await store.delete(ctx.id, 'default', true);
        expect(repeatRes).toBe(false);
      });

      it('filters queries consistently by namespace, multi-scope, type, lifecycle, and full-text', async () => {
        const items = [
          createCanonicalContext({
            content: { text: 'Alpha TypeScript build configuration' },
            metadata: { category: 'build', tags: ['ts', 'config'] },
            type: 'fact',
            scope: 'scope:alpha',
          }),
          createCanonicalContext({
            content: { text: 'Alpha database migration plan' },
            metadata: { category: 'db', tags: ['sql', 'migration'] },
            type: 'decision',
            scope: 'scope:alpha',
          }),
          createCanonicalContext({
            content: { text: 'Beta performance benchmark results' },
            metadata: { category: 'perf', tags: ['metrics', 'benchmark'] },
            type: 'observation',
            scope: 'scope:beta',
          }),
          createCanonicalContext({
            content: { text: 'Gamma obsolete design pattern' },
            metadata: { category: 'deprecated', tags: ['legacy'] },
            type: 'pattern',
            scope: 'scope:gamma',
            lifecycle: 'soft_deleted',
          }),
        ];

        for (const item of items) {
          await store.put(item);
        }

        // Multi-scope query
        const multiScopeRes = await store.query({
          namespace: 'default',
          scope: ['scope:alpha', 'scope:beta'],
        });
        expect(multiScopeRes.items.length).toBe(3);

        // Type query
        const typeRes = await store.query({
          namespace: 'default',
          types: ['decision', 'observation'],
        });
        expect(typeRes.items.length).toBe(2);

        // Lifecycle query (including soft_deleted)
        const lifecycleRes = await store.query({
          namespace: 'default',
          lifecycle: ['soft_deleted'],
        });
        expect(lifecycleRes.items.length).toBe(1);
        expect(lifecycleRes.items[0].id).toBe(items[3].id);

        // Full-text search in content
        const ftContentRes = await store.query({
          namespace: 'default',
          fullText: 'TypeScript build',
        });
        expect(ftContentRes.items.length).toBe(1);
        expect(ftContentRes.items[0].id).toBe(items[0].id);

        // Full-text search in metadata tags
        const ftMetaRes = await store.query({
          namespace: 'default',
          fullText: 'migration',
        });
        expect(ftMetaRes.items.length).toBe(1);
        expect(ftMetaRes.items[0].id).toBe(items[1].id);
      });

      it('executes complex batch mutations consistently', async () => {
        const c1 = createCanonicalContext({ content: { text: 'Initial 1' } });
        const c2 = createCanonicalContext({ content: { text: 'Initial 2' } });
        const c3 = createCanonicalContext({ content: { text: 'Initial 3' } });

        await store.put(c1);
        await store.put(c2);

        const batchResult = await store.batch({
          puts: [c3],
          updates: [
            {
              id: c1.id,
              expectedRevision: 1,
              patch: { content: { text: 'Initial 1 Mutated' } },
            },
          ],
          deletes: [c2.id],
        });

        expect(batchResult.applied).toBe(true);

        const res1 = await store.get(c1.id, 'default');
        expect(res1?.content.text).toBe('Initial 1 Mutated');
        expect(res1?.version.revision).toBe(2);

        const res2 = await store.get(c2.id, 'default');
        expect(res2).toBeUndefined();

        const res3 = await store.get(c3.id, 'default');
        expect(res3?.content.text).toBe('Initial 3');
      });
    });
  }

  describe('Cross-Provider Query Equivalence Verification', () => {
    let stores: { name: string; store: ContextStore; cleanup: () => Promise<void> }[] = [];

    beforeEach(async () => {
      stores = [];
      for (const provider of providers) {
        const instance = await provider.create();
        await instance.store.connect();
        stores.push({ name: provider.name, store: instance.store, cleanup: instance.cleanup });
      }
    });

    afterEach(async () => {
      for (const { cleanup } of stores) {
        await cleanup();
      }
    });

    it('returns identical result sets across Memory, JSON, and SQLite for identical datasets', async () => {
      const types: ContextType[] = ['fact', 'decision', 'preference', 'instruction', 'artifact', 'observation', 'summary', 'checkpoint'];
      const dataset: CanonicalContext[] = types.map((type, i) =>
        createCanonicalContext({
          content: { text: `Dataset entry ${i + 1} with topic keyword-${(i % 3) + 1}` },
          type,
          scope: `scope-${(i % 2) + 1}`,
          metadata: { index: i + 1, tag: `tag-${i + 1}`, metaKey: `meta-value-${(i % 3) + 1}` },
        })
      );

      // Seed all stores with exact same data
      for (const { store } of stores) {
        for (const item of dataset) {
          await store.put(item);
        }
      }

      // Define distinct query scenarios
      const queryScenarios = [
        { name: 'all items ordered by createdAt asc', q: { namespace: 'default', pagination: { order: 'asc' as const, orderBy: 'createdAt' as const } } },
        { name: 'scope-1 items', q: { namespace: 'default', scope: 'scope-1' } },
        { name: 'fact & decision types', q: { namespace: 'default', types: ['fact', 'decision'] } },
        { name: 'full text content search for keyword-2', q: { namespace: 'default', fullText: 'keyword-2' } },
        { name: 'full text metadata search for meta-value-1', q: { namespace: 'default', fullText: 'meta-value-1' } },
      ];

      for (const scenario of queryScenarios) {
        const results = await Promise.all(
          stores.map(async ({ name, store }) => ({
            name,
            res: await store.query(scenario.q),
          }))
        );

        const memoryIds = results[0].res.items.map((it) => it.id);
        const jsonIds = results[1].res.items.map((it) => it.id);
        const sqliteIds = results[2].res.items.map((it) => it.id);

        expect(jsonIds, `JSON provider results should match Memory provider for scenario: ${scenario.name}`).toEqual(memoryIds);
        expect(sqliteIds, `SQLite provider results should match Memory provider for scenario: ${scenario.name}`).toEqual(memoryIds);
      }
    });
  });
});

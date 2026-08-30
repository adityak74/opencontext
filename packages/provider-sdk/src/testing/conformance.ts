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

    it('returns undefined when getting non-existent entity', async () => {
      const retrieved = await store.get('non-existent-id', 'default');
      expect(retrieved).toBeUndefined();
    });

    it('pings the store successfully', async () => {
      await expect(store.ping()).resolves.toBeUndefined();
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

    it('throws error when updating non-existent context', async () => {
      await expect(
        store.update('non-existent-id', 'default', 1, { content: { text: 'Ghost' } })
      ).rejects.toThrow(/not found/i);
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

      const res3 = await store.query({ namespace: 'default', scope: ['s1', 's2'] });
      expect(res3.items.length).toBe(3);
    });

    it('queries contexts with full-text search', async () => {
      const c1 = createCanonicalContext({ content: { text: 'TypeScript compiler options' } });
      const c2 = createCanonicalContext({ content: { text: 'Python virtual environments' } });

      await store.put(c1);
      await store.put(c2);

      const res = await store.query({ namespace: 'default', fullText: 'typescript' });
      expect(res.items.length).toBe(1);
      expect(res.items[0].content.text).toBe('TypeScript compiler options');
    });

    it('performs soft and hard delete', async () => {
      const ctx = createCanonicalContext({ content: { text: 'Delete me' } });
      await store.put(ctx);

      // Soft delete
      const softRes = await store.delete(ctx.id, 'default', false);
      expect(softRes).toBe(true);
      const softDeleted = await store.get(ctx.id, 'default');
      expect(softDeleted?.lifecycle).toBe('soft_deleted');

      // Hard delete
      const hardRes = await store.delete(ctx.id, 'default', true);
      expect(hardRes).toBe(true);
      const hardDeleted = await store.get(ctx.id, 'default');
      expect(hardDeleted).toBeUndefined();

      // Deleting non-existent returns false
      const nonExistentRes = await store.delete('non-existent-id', 'default', true);
      expect(nonExistentRes).toBe(false);
    });

    it('executes batch mutations with puts, updates, and deletes', async () => {
      const c1 = createCanonicalContext({ content: { text: 'Item 1' } });
      const c2 = createCanonicalContext({ content: { text: 'Item 2' } });

      await store.put(c1);

      const batchRes = await store.batch({
        puts: [c2],
        updates: [
          {
            id: c1.id,
            expectedRevision: 1,
            patch: { content: { text: 'Item 1 Updated' } },
          },
        ],
      });
      expect(batchRes.applied).toBe(true);

      const retrieved1 = await store.get(c1.id, 'default');
      expect(retrieved1?.content.text).toBe('Item 1 Updated');
      expect(retrieved1?.version.revision).toBe(2);

      const retrieved2 = await store.get(c2.id, 'default');
      expect(retrieved2?.content.text).toBe('Item 2');

      const deleteBatchRes = await store.batch({
        deletes: [c1.id, c2.id],
      });
      expect(deleteBatchRes.applied).toBe(true);

      expect(await store.get(c1.id, 'default')).toBeUndefined();
      expect(await store.get(c2.id, 'default')).toBeUndefined();
    });
  });
}

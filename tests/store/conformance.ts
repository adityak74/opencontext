import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ContextStoreAdapter } from '../../src/store/types.js';

export interface ConformanceHarness {
  /** Allocate fresh, empty storage. Called once before each test. */
  setup(): Promise<void>;
  /** Open an adapter on the storage `setup` allocated. May be called twice in
   *  one test to prove data survives reconnection. */
  create(): Promise<ContextStoreAdapter>;
  /** Release the storage `setup` allocated. Called once after each test. */
  teardown(): Promise<void>;
}

/**
 * The storage contract, run against every adapter.
 *
 * Any backend that passes this suite is a drop-in replacement for the others.
 * Ordering assertions encode the documented contract: createdAt ascending, then
 * id ascending.
 */
export function runStoreConformance(name: string, harness: ConformanceHarness): void {
  describe(`${name} — store conformance`, () => {
    let store: ContextStoreAdapter;

    beforeEach(async () => {
      await harness.setup();
      store = await harness.create();
    });

    afterEach(async () => {
      await store.close();
      await harness.teardown();
    });

    // -----------------------------------------------------------------------
    // Contexts
    // -----------------------------------------------------------------------

    describe('saveContext', () => {
      it('saves an entry and returns it with an id and timestamps', async () => {
        const entry = await store.saveContext('My favorite color is blue');
        expect(entry.id).toBeTruthy();
        expect(entry.content).toBe('My favorite color is blue');
        expect(entry.tags).toEqual([]);
        expect(entry.source).toBe('chat');
        expect(entry.createdAt).toBeTruthy();
        expect(entry.updatedAt).toBe(entry.createdAt);
      });

      it('stores tags and source', async () => {
        const entry = await store.saveContext('Use tabs', ['style', 'code'], 'code-review');
        expect(entry.tags).toEqual(['style', 'code']);
        expect(entry.source).toBe('code-review');
      });

      it('persists across adapter instances', async () => {
        await store.saveContext('Persisted entry');
        const reopened = await harness.create();
        try {
          const all = await reopened.listContexts();
          expect(all.map((e) => e.content)).toContain('Persisted entry');
        } finally {
          await reopened.close();
        }
      });

      it('associates an entry with a bubble', async () => {
        const bubble = await store.createBubble('Work');
        const entry = await store.saveContext('Standup at 9', [], 'chat', bubble.id);
        expect(entry.bubbleId).toBe(bubble.id);
      });

      it('leaves bubbleId undefined when none is given', async () => {
        const entry = await store.saveContext('Unfiled');
        expect(entry.bubbleId).toBeUndefined();
      });

      it('round-trips content containing quotes and newlines', async () => {
        const tricky = `He said "hello"\nthen left; DROP TABLE oc_contexts; --`;
        const saved = await store.saveContext(tricky, ["it's"]);
        const found = await store.getContext(saved.id);
        expect(found?.content).toBe(tricky);
        expect(found?.tags).toEqual(["it's"]);
      });

      it('round-trips unicode content', async () => {
        const saved = await store.saveContext('日本語 🎉 café');
        expect((await store.getContext(saved.id))?.content).toBe('日本語 🎉 café');
      });
    });

    describe('getContext', () => {
      it('returns the entry by id', async () => {
        const saved = await store.saveContext('Find me');
        expect((await store.getContext(saved.id))?.content).toBe('Find me');
      });

      it('returns undefined for an unknown id', async () => {
        expect(await store.getContext('does-not-exist')).toBeUndefined();
      });
    });

    describe('recallContext', () => {
      beforeEach(async () => {
        await store.saveContext('I prefer dark mode', ['tooling']);
        await store.saveContext('My cat is named Luna');
        await store.saveContext('Dark themes are better for my eyes');
      });

      it('matches content case-insensitively', async () => {
        const results = await store.recallContext('dark');
        expect(results).toHaveLength(2);
      });

      it('matches tags', async () => {
        const results = await store.recallContext('tooling');
        expect(results).toHaveLength(1);
        expect(results[0]!.content).toBe('I prefer dark mode');
      });

      it('returns an empty array when nothing matches', async () => {
        expect(await store.recallContext('xyz-not-found')).toEqual([]);
      });

      it('is case-insensitive on the query itself', async () => {
        expect(await store.recallContext('LUNA')).toHaveLength(1);
      });
    });

    describe('searchContexts', () => {
      beforeEach(async () => {
        await store.saveContext('TypeScript strict mode is on', ['lang'], 'code-review');
        await store.saveContext('TypeScript is fine', ['lang']);
        await store.saveContext('Python is also fine');
      });

      it('requires every term to match', async () => {
        const results = await store.searchContexts('typescript strict');
        expect(results).toHaveLength(1);
      });

      it('searches across content, tags and source', async () => {
        const results = await store.searchContexts('typescript code-review');
        expect(results).toHaveLength(1);
      });

      it('returns everything for an all-whitespace query', async () => {
        expect(await store.searchContexts('   ')).toHaveLength(3);
      });

      it('returns an empty array when one term fails to match', async () => {
        expect(await store.searchContexts('typescript nonexistent')).toEqual([]);
      });
    });

    describe('listContexts', () => {
      it('returns an empty array for a fresh store', async () => {
        expect(await store.listContexts()).toEqual([]);
      });

      it('returns every entry', async () => {
        await store.saveContext('One');
        await store.saveContext('Two');
        expect(await store.listContexts()).toHaveLength(2);
      });

      it('filters by exact tag, case-insensitively', async () => {
        await store.saveContext('Tagged', ['Work']);
        await store.saveContext('Untagged');
        expect(await store.listContexts('work')).toHaveLength(1);
        expect(await store.listContexts('WORK')).toHaveLength(1);
      });

      it('does not match a tag by prefix', async () => {
        await store.saveContext('Tagged', ['workspace']);
        expect(await store.listContexts('work')).toEqual([]);
      });

      it('orders by createdAt then id', async () => {
        await store.saveContext('a');
        await store.saveContext('b');
        await store.saveContext('c');
        const all = await store.listContexts();
        const expected = [...all].sort(
          (x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id),
        );
        expect(all.map((e) => e.id)).toEqual(expected.map((e) => e.id));
      });
    });

    describe('updateContext', () => {
      it('updates content and bumps updatedAt', async () => {
        const saved = await store.saveContext('Original');
        await new Promise((resolve) => setTimeout(resolve, 2));
        const updated = await store.updateContext(saved.id, 'Revised');
        expect(updated?.content).toBe('Revised');
        expect(updated?.createdAt).toBe(saved.createdAt);
        expect(updated!.updatedAt >= saved.updatedAt).toBe(true);
      });

      it('replaces tags when given', async () => {
        const saved = await store.saveContext('Entry', ['old']);
        const updated = await store.updateContext(saved.id, 'Entry', ['new', 'newer']);
        expect(updated?.tags).toEqual(['new', 'newer']);
      });

      it('leaves tags alone when omitted', async () => {
        const saved = await store.saveContext('Entry', ['keep']);
        const updated = await store.updateContext(saved.id, 'Changed');
        expect(updated?.tags).toEqual(['keep']);
      });

      it('assigns a bubble', async () => {
        const bubble = await store.createBubble('Proj');
        const saved = await store.saveContext('Entry');
        const updated = await store.updateContext(saved.id, 'Entry', undefined, bubble.id);
        expect(updated?.bubbleId).toBe(bubble.id);
      });

      it('unassigns a bubble when passed null', async () => {
        const bubble = await store.createBubble('Proj');
        const saved = await store.saveContext('Entry', [], 'chat', bubble.id);
        const updated = await store.updateContext(saved.id, 'Entry', undefined, null);
        expect(updated?.bubbleId).toBeUndefined();
      });

      it('persists the update', async () => {
        const saved = await store.saveContext('Original');
        await store.updateContext(saved.id, 'Revised');
        expect((await store.getContext(saved.id))?.content).toBe('Revised');
      });

      it('returns undefined for an unknown id', async () => {
        expect(await store.updateContext('nope', 'x')).toBeUndefined();
      });
    });

    describe('deleteContext', () => {
      it('deletes and reports true', async () => {
        const saved = await store.saveContext('Delete me');
        expect(await store.deleteContext(saved.id)).toBe(true);
        expect(await store.getContext(saved.id)).toBeUndefined();
      });

      it('reports false for an unknown id', async () => {
        expect(await store.deleteContext('nope')).toBe(false);
      });

      it('leaves other entries intact', async () => {
        const first = await store.saveContext('Keep');
        const second = await store.saveContext('Remove');
        await store.deleteContext(second.id);
        const all = await store.listContexts();
        expect(all).toHaveLength(1);
        expect(all[0]!.id).toBe(first.id);
      });
    });

    // -----------------------------------------------------------------------
    // Bubbles
    // -----------------------------------------------------------------------

    describe('createBubble', () => {
      it('creates a bubble with an id and timestamps', async () => {
        const bubble = await store.createBubble('Side project');
        expect(bubble.id).toBeTruthy();
        expect(bubble.name).toBe('Side project');
        expect(bubble.description).toBeUndefined();
        expect(bubble.updatedAt).toBe(bubble.createdAt);
      });

      it('stores a description when given', async () => {
        const bubble = await store.createBubble('Work', 'Day job context');
        expect(bubble.description).toBe('Day job context');
      });
    });

    describe('listBubbles / getBubble', () => {
      it('returns an empty array for a fresh store', async () => {
        expect(await store.listBubbles()).toEqual([]);
      });

      it('lists created bubbles', async () => {
        await store.createBubble('One');
        await store.createBubble('Two');
        expect(await store.listBubbles()).toHaveLength(2);
      });

      it('gets a bubble by id', async () => {
        const created = await store.createBubble('Findable');
        expect((await store.getBubble(created.id))?.name).toBe('Findable');
      });

      it('returns undefined for an unknown bubble id', async () => {
        expect(await store.getBubble('nope')).toBeUndefined();
      });
    });

    describe('listContextsByBubble', () => {
      it('returns only that bubble’s contexts', async () => {
        const a = await store.createBubble('A');
        const b = await store.createBubble('B');
        await store.saveContext('in a', [], 'chat', a.id);
        await store.saveContext('in b', [], 'chat', b.id);
        await store.saveContext('unfiled');

        const inA = await store.listContextsByBubble(a.id);
        expect(inA).toHaveLength(1);
        expect(inA[0]!.content).toBe('in a');
      });

      it('returns an empty array for a bubble with no contexts', async () => {
        const bubble = await store.createBubble('Empty');
        expect(await store.listContextsByBubble(bubble.id)).toEqual([]);
      });
    });

    describe('updateBubble', () => {
      it('renames a bubble', async () => {
        const created = await store.createBubble('Before');
        const updated = await store.updateBubble(created.id, 'After');
        expect(updated?.name).toBe('After');
      });

      it('updates the description when given', async () => {
        const created = await store.createBubble('Name', 'old');
        expect((await store.updateBubble(created.id, 'Name', 'new'))?.description).toBe('new');
      });

      it('leaves the description alone when omitted', async () => {
        const created = await store.createBubble('Name', 'keep');
        expect((await store.updateBubble(created.id, 'Renamed'))?.description).toBe('keep');
      });

      it('returns undefined for an unknown id', async () => {
        expect(await store.updateBubble('nope', 'x')).toBeUndefined();
      });
    });

    describe('deleteBubble', () => {
      it('unassigns its contexts by default rather than deleting them', async () => {
        const bubble = await store.createBubble('Temp');
        const entry = await store.saveContext('Survives', [], 'chat', bubble.id);

        expect(await store.deleteBubble(bubble.id)).toBe(true);
        expect(await store.getBubble(bubble.id)).toBeUndefined();

        const survivor = await store.getContext(entry.id);
        expect(survivor).toBeDefined();
        expect(survivor?.bubbleId).toBeUndefined();
      });

      it('deletes its contexts when asked', async () => {
        const bubble = await store.createBubble('Temp');
        const entry = await store.saveContext('Goes away', [], 'chat', bubble.id);

        expect(await store.deleteBubble(bubble.id, true)).toBe(true);
        expect(await store.getContext(entry.id)).toBeUndefined();
      });

      it('leaves contexts in other bubbles untouched', async () => {
        const doomed = await store.createBubble('Doomed');
        const safe = await store.createBubble('Safe');
        await store.saveContext('in doomed', [], 'chat', doomed.id);
        const keeper = await store.saveContext('in safe', [], 'chat', safe.id);

        await store.deleteBubble(doomed.id, true);
        expect((await store.getContext(keeper.id))?.bubbleId).toBe(safe.id);
      });

      it('reports false for an unknown id', async () => {
        expect(await store.deleteBubble('nope')).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    describe('lifecycle', () => {
      it('reports adapter info with a redacted target', async () => {
        expect(store.info.scheme).toBeTruthy();
        expect(store.info.label).toBeTruthy();
        expect(store.info.target).not.toMatch(/hunter2|secret-token/);
      });

      it('pings a live connection without throwing', async () => {
        await expect(store.ping()).resolves.toBeUndefined();
      });
    });
  });
}

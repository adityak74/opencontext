import { describe, it, expect, vi } from 'vitest';
import { ContextStoreV1Shim, ContextEntry, Bubble } from '../src/shims/v1-shim.js';
import type { CanonicalContext } from '../src/model/types.js';

describe('ContextStoreV1Shim', () => {
  function createMockContext(overrides: Partial<CanonicalContext> = {}): CanonicalContext {
    return {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      namespace: 'default',
      scope: 'global',
      type: 'fact',
      content: { text: 'Test content', mediaType: 'text/plain' },
      metadata: { tags: ['tag1'] },
      provenance: {
        actor: 'user',
        sourceUri: 'custom-cli',
        contentHash: 'hash123',
      },
      relationships: [],
      timestamps: {
        createdAt: '2026-08-25T01:00:00.000Z',
        updatedAt: '2026-08-25T01:00:00.000Z',
      },
      version: { revision: 1 },
      lifecycle: 'active',
      ...overrides,
    };
  }

  describe('saveContext', () => {
    it('converts legacy saveContext arguments into a CanonicalContext and saves it with bubble', async () => {
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
      expect(saved!.metadata.legacySource).toBe('chat');
      expect(saved!.scope).toBe('bubble:bubble_123');
      expect(saved!.provenance.actor).toBe('user');
      expect(saved!.provenance.sourceUri).toBe('chat');
      expect(saved!.relationships).toEqual([{ targetId: 'bubble_123', relation: 'child_of' }]);
    });

    it('uses defaults for tags and source when omitted, sets global scope when bubbleId is omitted', async () => {
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
      const entry = await shim.saveContext('Simple note');

      expect(entry.content).toBe('Simple note');
      expect(entry.tags).toEqual([]);
      expect(entry.source).toBe('chat');
      expect(entry.bubbleId).toBeUndefined();

      expect(saved).toBeDefined();
      expect(saved!.scope).toBe('global');
      expect(saved!.provenance.actor).toBe('user');
      expect(saved!.relationships).toEqual([]);
    });

    it('sets actor to system for non-chat/non-user sources', async () => {
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
      await shim.saveContext('Cron log', ['log'], 'cron-job');

      expect(saved).toBeDefined();
      expect(saved!.provenance.actor).toBe('system');
      expect(saved!.provenance.sourceUri).toBe('cron-job');
    });

    it('sets actor to user when source is user', async () => {
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
      await shim.saveContext('User note', ['note'], 'user');

      expect(saved).toBeDefined();
      expect(saved!.provenance.actor).toBe('user');
    });
  });

  describe('getContext', () => {
    it('returns ContextEntry when context exists and is not a bubble', async () => {
      const mockContext = createMockContext({ id: 'ctx-1', content: { text: 'Found context' } });
      const mockStore = {
        put: vi.fn(),
        query: vi.fn(),
        get: vi.fn().mockResolvedValue(mockContext),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const entry = await shim.getContext('ctx-1');

      expect(mockStore.get).toHaveBeenCalledWith('ctx-1', 'default');
      expect(entry).toBeDefined();
      expect(entry!.id).toBe('ctx-1');
      expect(entry!.content).toBe('Found context');
    });

    it('returns undefined when context is not found', async () => {
      const mockStore = {
        put: vi.fn(),
        query: vi.fn(),
        get: vi.fn().mockResolvedValue(undefined),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const entry = await shim.getContext('nonexistent');

      expect(entry).toBeUndefined();
    });

    it('returns undefined when context is a bubble checkpoint', async () => {
      const mockBubble = createMockContext({
        id: 'bubble-1',
        type: 'checkpoint',
        metadata: { name: 'Bubble 1', isBubble: true },
      });
      const mockStore = {
        put: vi.fn(),
        query: vi.fn(),
        get: vi.fn().mockResolvedValue(mockBubble),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const entry = await shim.getContext('bubble-1');

      expect(entry).toBeUndefined();
    });
  });

  describe('listContexts', () => {
    it('returns all active contexts excluding bubbles', async () => {
      const item1 = createMockContext({ id: '1', content: { text: 'Item 1' }, metadata: { tags: ['a'] } });
      const item2 = createMockContext({ id: '2', content: { text: 'Item 2' }, metadata: { tags: ['b'] } });
      const bubbleItem = createMockContext({ id: '3', type: 'checkpoint', metadata: { isBubble: true } });

      const mockStore = {
        put: vi.fn(),
        query: vi.fn().mockResolvedValue({ items: [item1, item2, bubbleItem] }),
        get: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const entries = await shim.listContexts();

      expect(mockStore.query).toHaveBeenCalledWith({
        namespace: 'default',
        lifecycle: ['active'],
        pagination: { limit: 10000, order: 'asc', orderBy: 'createdAt' },
      });
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.id)).toEqual(['1', '2']);
    });

    it('filters by tag when provided', async () => {
      const item1 = createMockContext({ id: '1', metadata: { tags: ['urgent', 'work'] } });
      const item2 = createMockContext({ id: '2', metadata: { tags: ['work'] } });
      const item3 = createMockContext({ id: '3', metadata: { tags: ['personal'] } });

      const mockStore = {
        put: vi.fn(),
        query: vi.fn().mockResolvedValue({ items: [item1, item2, item3] }),
        get: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const entries = await shim.listContexts('urgent');

      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('1');
    });
  });

  describe('listContextsByBubble', () => {
    it('queries contexts scoped to bubbleId and filters out bubbles', async () => {
      const item1 = createMockContext({ id: '1', scope: 'bubble:b_1' });
      const bubbleItem = createMockContext({ id: 'b_1', type: 'checkpoint', metadata: { isBubble: true } });

      const mockStore = {
        put: vi.fn(),
        query: vi.fn().mockResolvedValue({ items: [item1, bubbleItem] }),
        get: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const entries = await shim.listContextsByBubble('b_1');

      expect(mockStore.query).toHaveBeenCalledWith({
        namespace: 'default',
        scope: 'bubble:b_1',
        lifecycle: ['active'],
        pagination: { limit: 10000, order: 'asc', orderBy: 'createdAt' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('1');
    });
  });

  describe('updateContext', () => {
    it('returns undefined if existing item is not found', async () => {
      const mockStore = {
        put: vi.fn(),
        query: vi.fn(),
        get: vi.fn().mockResolvedValue(undefined),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const result = await shim.updateContext('missing', 'new text');

      expect(result).toBeUndefined();
      expect(mockStore.update).not.toHaveBeenCalled();
    });

    it('updates content, tags, and optimistic revision', async () => {
      const existing = createMockContext({
        id: 'ctx-1',
        content: { text: 'Old content' },
        metadata: { tags: ['old-tag'], customMeta: 'preserved' },
        version: { revision: 3 },
      });

      let patchArg: any;
      const mockStore = {
        put: vi.fn(),
        query: vi.fn(),
        get: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(async (id, ns, rev, patch) => {
          patchArg = patch;
          return {
            ...existing,
            content: patch.content,
            metadata: patch.metadata,
            timestamps: patch.timestamps,
            version: { revision: rev + 1 },
          };
        }),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const result = await shim.updateContext('ctx-1', 'Updated content', ['new-tag']);

      expect(mockStore.update).toHaveBeenCalledWith('ctx-1', 'default', 3, expect.any(Object));
      expect(patchArg.content.text).toBe('Updated content');
      expect(patchArg.metadata.tags).toEqual(['new-tag']);
      expect(patchArg.metadata.customMeta).toBe('preserved');
      expect(patchArg.timestamps.updatedAt).toBeDefined();

      expect(result).toBeDefined();
      expect(result!.content).toBe('Updated content');
      expect(result!.tags).toEqual(['new-tag']);
    });

    it('sets scope to global and removes child_of relationship when bubbleId is null', async () => {
      const existing = createMockContext({
        id: 'ctx-1',
        scope: 'bubble:old-bubble',
        relationships: [
          { targetId: 'old-bubble', relation: 'child_of' },
          { targetId: 'ref-1', relation: 'references' },
        ],
      });

      let patchArg: any;
      const mockStore = {
        put: vi.fn(),
        query: vi.fn(),
        get: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(async (id, ns, rev, patch) => {
          patchArg = patch;
          return { ...existing, ...patch };
        }),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      await shim.updateContext('ctx-1', 'Updated content', undefined, null);

      expect(patchArg.scope).toBe('global');
      expect(patchArg.relationships).toEqual([{ targetId: 'ref-1', relation: 'references' }]);
    });

    it('sets scope to bubble and replaces child_of relationship when bubbleId is a string', async () => {
      const existing = createMockContext({
        id: 'ctx-1',
        scope: 'bubble:old-bubble',
        relationships: [
          { targetId: 'old-bubble', relation: 'child_of' },
          { targetId: 'ref-1', relation: 'references' },
        ],
      });

      let patchArg: any;
      const mockStore = {
        put: vi.fn(),
        query: vi.fn(),
        get: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(async (id, ns, rev, patch) => {
          patchArg = patch;
          return { ...existing, ...patch };
        }),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      await shim.updateContext('ctx-1', 'Updated content', undefined, 'new-bubble');

      expect(patchArg.scope).toBe('bubble:new-bubble');
      expect(patchArg.relationships).toEqual([
        { targetId: 'ref-1', relation: 'references' },
        { targetId: 'new-bubble', relation: 'child_of' },
      ]);
    });
  });

  describe('deleteContext', () => {
    it('calls store.delete with hard deletion', async () => {
      const mockStore = {
        put: vi.fn(),
        query: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        delete: vi.fn().mockResolvedValue(true),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const result = await shim.deleteContext('ctx-to-delete');

      expect(mockStore.delete).toHaveBeenCalledWith('ctx-to-delete', 'default', true);
      expect(result).toBe(true);
    });
  });

  describe('searchContexts', () => {
    it('queries with fullText and excludes bubbles', async () => {
      const item1 = createMockContext({ id: '1', content: { text: 'Matching item' } });
      const bubbleItem = createMockContext({ id: 'b_1', type: 'checkpoint', metadata: { isBubble: true } });

      const mockStore = {
        put: vi.fn(),
        query: vi.fn().mockResolvedValue({ items: [item1, bubbleItem] }),
        get: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const results = await shim.searchContexts('match');

      expect(mockStore.query).toHaveBeenCalledWith({
        namespace: 'default',
        fullText: 'match',
        lifecycle: ['active'],
        pagination: { limit: 100 },
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
    });
  });

  describe('createBubble and listBubbles', () => {
    it('creates a checkpoint canonical context with isBubble metadata', async () => {
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
      const bubble = await shim.createBubble('Project Alpha', 'Alpha description');

      expect(bubble.name).toBe('Project Alpha');
      expect(bubble.description).toBe('Alpha description');
      expect(saved).toBeDefined();
      expect(saved!.type).toBe('checkpoint');
      expect(saved!.metadata.isBubble).toBe(true);
      expect(saved!.metadata.name).toBe('Project Alpha');
      expect(saved!.metadata.description).toBe('Alpha description');
    });

    it('lists only bubbles from checkpoint contexts', async () => {
      const bubble1 = createMockContext({
        id: 'b-1',
        type: 'checkpoint',
        metadata: { name: 'Bubble 1', isBubble: true },
      });
      const nonBubbleCheckpoint = createMockContext({
        id: 'cp-1',
        type: 'checkpoint',
        metadata: { name: 'Snapshot' },
      });

      const mockStore = {
        put: vi.fn(),
        query: vi.fn().mockResolvedValue({ items: [bubble1, nonBubbleCheckpoint] }),
        get: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const shim = new ContextStoreV1Shim(mockStore as any);
      const bubbles = await shim.listBubbles();

      expect(mockStore.query).toHaveBeenCalledWith({
        namespace: 'default',
        types: ['checkpoint'],
        lifecycle: ['active'],
        pagination: { limit: 1000 },
      });
      expect(bubbles).toHaveLength(1);
      expect(bubbles[0].id).toBe('b-1');
      expect(bubbles[0].name).toBe('Bubble 1');
    });
  });

  describe('toV1Entry and toBubble transformations', () => {
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
      expect(entry.createdAt).toBe('2026-08-25T01:00:00.000Z');
      expect(entry.updatedAt).toBe('2026-08-25T01:00:00.000Z');
    });

    it('falls back to JSON serialized structured content when text is undefined', () => {
      const shim = new ContextStoreV1Shim({} as any);
      const canonical = createMockContext({
        content: { structured: { key: 'value', count: 42 } },
        metadata: {},
        provenance: { actor: 'agent', contentHash: 'hash' },
        relationships: [],
      });

      const entry = shim.toV1Entry(canonical);
      expect(entry.content).toBe('{"key":"value","count":42}');
      expect(entry.tags).toEqual([]);
      expect(entry.source).toBe('agent');
      expect(entry.bubbleId).toBeUndefined();
    });

    it('toBubble extracts name and description correctly', () => {
      const shim = new ContextStoreV1Shim({} as any);
      const canonical = createMockContext({
        id: 'bubble_xyz',
        metadata: { name: 'My Bubble', description: 'Some desc', isBubble: true },
        timestamps: {
          createdAt: '2026-08-25T01:00:00.000Z',
          updatedAt: '2026-08-25T01:00:00.000Z',
        },
      });

      const bubble = shim.toBubble(canonical);
      expect(bubble.id).toBe('bubble_xyz');
      expect(bubble.name).toBe('My Bubble');
      expect(bubble.description).toBe('Some desc');
      expect(bubble.createdAt).toBe('2026-08-25T01:00:00.000Z');
      expect(bubble.updatedAt).toBe('2026-08-25T01:00:00.000Z');
    });

    it('toBubble falls back to content.text when metadata.name is not set', () => {
      const shim = new ContextStoreV1Shim({} as any);
      const canonical = createMockContext({
        id: 'bubble_fallback',
        content: { text: 'Fallback Name' },
        metadata: { isBubble: true },
      });

      const bubble = shim.toBubble(canonical);
      expect(bubble.name).toBe('Fallback Name');
      expect(bubble.description).toBeUndefined();
    });
  });
});

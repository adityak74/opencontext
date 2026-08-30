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
    if (!item || (item.type === 'checkpoint' && item.metadata?.isBubble)) return undefined;
    return this.toV1Entry(item);
  }

  async listContexts(tag?: string): Promise<ContextEntry[]> {
    const result = await this.store.query({
      namespace: 'default',
      lifecycle: ['active'],
      pagination: { limit: 10000, order: 'asc', orderBy: 'createdAt' },
    });

    let items = result.items.filter((i) => !i.metadata?.isBubble);
    if (tag) {
      items = items.filter((i) => Array.isArray(i.metadata?.tags) && (i.metadata.tags as string[]).includes(tag));
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
    return result.items.filter((i) => !i.metadata?.isBubble).map((i) => this.toV1Entry(i));
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
      metadata: { ...existing.metadata, ...(tags !== undefined ? { tags } : {}) },
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
    return result.items.filter((i) => !i.metadata?.isBubble).map((i) => this.toV1Entry(i));
  }

  async recallContext(query: string): Promise<ContextEntry[]> {
    return this.searchContexts(query);
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
    return result.items.filter((i) => i.metadata?.isBubble).map((i) => this.toBubble(i));
  }

  async getBubble(id: string): Promise<Bubble | undefined> {
    const item = await this.store.get(id, 'default');
    if (!item || item.type !== 'checkpoint' || !item.metadata?.isBubble) return undefined;
    return this.toBubble(item);
  }

  async updateBubble(id: string, name: string, description?: string): Promise<Bubble | undefined> {
    const existing = await this.store.get(id, 'default');
    if (!existing || existing.type !== 'checkpoint' || !existing.metadata?.isBubble) return undefined;
    const patch: Partial<CanonicalContext> = {
      content: { ...existing.content, text: name },
      metadata: {
        ...existing.metadata,
        name,
        ...(description !== undefined ? { description } : {}),
      },
      timestamps: { ...existing.timestamps, updatedAt: new Date().toISOString() },
    };
    const updated = await this.store.update(id, 'default', existing.version.revision, patch);
    return this.toBubble(updated);
  }

  async deleteBubble(id: string, deleteContexts = false): Promise<boolean> {
    const existing = await this.store.get(id, 'default');
    if (!existing || existing.type !== 'checkpoint' || !existing.metadata?.isBubble) return false;
    if (deleteContexts) {
      const contexts = await this.listContextsByBubble(id);
      for (const ctx of contexts) {
        await this.deleteContext(ctx.id);
      }
    } else {
      const result = await this.store.query({
        namespace: 'default',
        scope: `bubble:${id}`,
        lifecycle: ['active'],
        pagination: { limit: 10000 },
      });
      for (const item of result.items) {
        const patch: Partial<CanonicalContext> = {
          scope: 'global',
          relationships: item.relationships.filter((r) => r.relation !== 'child_of'),
          timestamps: { ...item.timestamps, updatedAt: new Date().toISOString() },
        };
        await this.store.update(item.id, 'default', item.version.revision, patch);
      }
    }
    return this.store.delete(id, 'default', true);
  }

  toV1Entry(ctx: CanonicalContext): ContextEntry {
    const bubbleChild = ctx.relationships?.find((r) => r.relation === 'child_of');
    return {
      id: ctx.id,
      content: ctx.content.text ?? JSON.stringify(ctx.content.structured ?? {}),
      tags: Array.isArray(ctx.metadata?.tags) ? (ctx.metadata.tags as string[]) : [],
      source: ctx.provenance.sourceUri ?? ctx.provenance.actor,
      bubbleId: bubbleChild ? bubbleChild.targetId : undefined,
      createdAt: ctx.timestamps.createdAt,
      updatedAt: ctx.timestamps.updatedAt,
    };
  }

  toBubble(ctx: CanonicalContext): Bubble {
    return {
      id: ctx.id,
      name: (ctx.metadata?.name as string) ?? ctx.content.text ?? '',
      description: ctx.metadata?.description as string | undefined,
      createdAt: ctx.timestamps.createdAt,
      updatedAt: ctx.timestamps.updatedAt,
    };
  }
}

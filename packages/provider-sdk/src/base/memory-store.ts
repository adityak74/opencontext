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
  async disconnect(): Promise<void> {
    this.records.clear();
  }
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
      const terms = q.fullText.toLowerCase().trim().split(/\s+/).filter(Boolean);
      items = items.filter((c) => {
        const text = (c.content.text ?? JSON.stringify(c.content.structured ?? {})).toLowerCase();
        const tags = Array.isArray(c.metadata?.tags) ? (c.metadata.tags as string[]).join(' ').toLowerCase() : '';
        const combined = `${text} ${tags}`;
        return terms.every((term) => combined.includes(term));
      });
    }

    const order = q.pagination?.order ?? 'asc';
    const orderBy = q.pagination?.orderBy ?? 'createdAt';
    items.sort((a, b) => {
      const valA = orderBy === 'revision' ? a.version.revision : a.timestamps[orderBy] ?? '';
      const valB = orderBy === 'revision' ? b.version.revision : b.timestamps[orderBy] ?? '';
      if (valA === valB) return a.id.localeCompare(b.id);
      return order === 'asc' ? (valA < valB ? -1 : 1) : (valA > valB ? -1 : 1);
    });

    const limit = q.pagination?.limit ?? 100;
    const paginated = items.slice(0, limit);
    return { items: paginated, totalCount: items.length };
  }

  async update(
    id: ContextId,
    namespace: NamespaceId = 'default',
    expectedRevision: number,
    patch: Partial<CanonicalContext>
  ): Promise<CanonicalContext> {
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
        ...(patch.version ?? {}),
        revision: existing.version.revision + 1,
      },
      timestamps: {
        ...existing.timestamps,
        ...(patch.timestamps ?? {}),
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
      existing.timestamps = {
        ...existing.timestamps,
        updatedAt: new Date().toISOString(),
      };
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

  dump(): CanonicalContext[] {
    return Array.from(this.records.values()).map((c) => ({ ...c }));
  }
}

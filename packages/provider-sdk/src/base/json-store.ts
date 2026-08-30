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
    const items = this.memory.dump();
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

  async update(
    id: ContextId,
    namespace: NamespaceId = 'default',
    expectedRevision: number,
    patch: Partial<CanonicalContext>
  ): Promise<CanonicalContext> {
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

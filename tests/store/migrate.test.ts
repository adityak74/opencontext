import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createStore } from '../../src/store/index.js';
import { migrateStore } from '../../src/store/migrate.js';
import type { ContextStoreAdapter } from '../../src/store/types.js';

describe('migrateStore', () => {
  let dir: string;
  let source: ContextStoreAdapter;
  let target: ContextStoreAdapter;

  beforeEach(async () => {
    dir = join(tmpdir(), `opencontext-migrate-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    // JSON to SQLite — the migration people actually run when they outgrow the
    // default file store.
    source = await createStore(`json://${join(dir, 'contexts.json')}`);
    target = await createStore(`sqlite://${join(dir, 'oc.db')}`);
  });

  afterEach(async () => {
    await source.close();
    await target.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('copies contexts and bubbles across', async () => {
    const bubble = await source.createBubble('Work', 'Day job');
    await source.saveContext('Standup at 9', ['meeting'], 'chat', bubble.id);
    await source.saveContext('Unfiled note');

    const result = await migrateStore(source, target);

    expect(result).toEqual({ contexts: 2, bubbles: 1 });
    expect(await target.listContexts()).toHaveLength(2);
    expect(await target.listBubbles()).toHaveLength(1);
  });

  it('preserves the context to bubble relationship', async () => {
    const bubble = await source.createBubble('Work');
    await source.saveContext('In a bubble', [], 'chat', bubble.id);

    await migrateStore(source, target);

    const targetBubble = (await target.listBubbles())[0]!;
    const inBubble = await target.listContextsByBubble(targetBubble.id);
    expect(inBubble).toHaveLength(1);
    expect(inBubble[0]!.content).toBe('In a bubble');
  });

  it('preserves tags and source', async () => {
    await source.saveContext('Tagged', ['a', 'b'], 'code-review');

    await migrateStore(source, target);

    const entry = (await target.listContexts())[0]!;
    expect(entry.tags).toEqual(['a', 'b']);
    expect(entry.source).toBe('code-review');
  });

  it('adds to existing data in copy mode', async () => {
    await target.saveContext('Already there');
    await source.saveContext('Incoming');

    await migrateStore(source, target, { mode: 'copy' });

    expect(await target.listContexts()).toHaveLength(2);
  });

  it('empties the target first in replace mode', async () => {
    await target.saveContext('Should be gone');
    await source.saveContext('Incoming');

    await migrateStore(source, target, { mode: 'replace' });

    const remaining = await target.listContexts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.content).toBe('Incoming');
  });

  it('never mutates the source', async () => {
    await source.saveContext('Original');
    const before = await source.listContexts();

    await migrateStore(source, target, { mode: 'replace' });

    expect(await source.listContexts()).toEqual(before);
  });

  it('survives replace mode when source and target are the same store', async () => {
    // Reading before clearing is what makes this safe — clearing first would
    // delete the very rows about to be copied.
    await source.saveContext('do not lose me', ['important']);
    const sameStore = await createStore(`json://${join(dir, 'contexts.json')}`);

    const result = await migrateStore(source, sameStore, { mode: 'replace' });

    expect(result.contexts).toBe(1);
    expect((await sameStore.listContexts())[0]!.content).toBe('do not lose me');
    await sameStore.close();
  });

  it('handles an empty source', async () => {
    expect(await migrateStore(source, target)).toEqual({ contexts: 0, bubbles: 0 });
  });
});

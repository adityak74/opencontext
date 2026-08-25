import { describe, it, expect, afterEach } from 'vitest';
import { createContextStoreFromDsn } from '../../src/store/manager.js';
import { createCanonicalContext } from '@opencontext/core';
import { InvalidDsnError, UnsupportedSchemeError } from '@opencontext/provider-sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';

describe('V2 DSN Store Loader', () => {
  const tmpJsonPath = path.join(process.cwd(), 'temp', 'v2-bridge-test.json');

  afterEach(async () => {
    try {
      await fs.unlink(tmpJsonPath);
    } catch {
      // ignore if does not exist
    }
  });

  it('instantiates MemoryContextStore for memory:// DSN', async () => {
    const store = await createContextStoreFromDsn('memory://');
    expect(store.id).toBe('memory');
    expect(store.capabilities.optimisticLocking).toBe(true);

    const ctx = createCanonicalContext({
      content: { text: 'Memory test context' },
      metadata: { tags: ['mem-tag'] },
    });
    await store.put(ctx);
    const retrieved = await store.get(ctx.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.content.text).toBe('Memory test context');
  });

  it('instantiates JsonContextStore for json:// DSN', async () => {
    const store = await createContextStoreFromDsn(`json://${tmpJsonPath}`);
    expect(store.id).toBe('json');

    const ctx = createCanonicalContext({
      content: { text: 'JSON test context' },
      metadata: { tags: ['json-tag'] },
    });
    await store.put(ctx);
    const retrieved = await store.get(ctx.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.content.text).toBe('JSON test context');
  });

  it('instantiates SqlContextStore for sqlite:// DSN', async () => {
    const store = await createContextStoreFromDsn('sqlite://:memory:');
    expect(store.id).toBe('sqlite');

    const ctx = createCanonicalContext({
      content: { text: 'SQLite test context' },
      metadata: { tags: ['sqlite-tag'] },
    });
    await store.put(ctx);
    const retrieved = await store.get(ctx.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.content.text).toBe('SQLite test context');
  });

  it('throws InvalidDsnError for malformed DSN', async () => {
    await expect(createContextStoreFromDsn('invalid-dsn')).rejects.toThrow(InvalidDsnError);
  });

  it('throws UnsupportedSchemeError for unregistered scheme', async () => {
    await expect(createContextStoreFromDsn('unsupported://endpoint')).rejects.toThrow(UnsupportedSchemeError);
  });
});

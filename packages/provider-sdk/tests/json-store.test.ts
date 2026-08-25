import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCanonicalContext } from '@opencontext/core';
import { JsonContextStore } from '../src/base/json-store.js';
import { runProviderConformanceSuite } from '../src/testing/conformance.js';

describe('JsonContextStore', () => {
  const testDir = path.join(os.tmpdir(), `opencontext-json-test-${Date.now()}`);
  const testFile = path.join(testDir, 'contexts.json');

  runProviderConformanceSuite('JsonContextStore', {
    create: async () => new JsonContextStore(testFile),
    cleanup: async () => {
      await fs.rm(testDir, { recursive: true, force: true });
    },
  });

  it('persists data across restarts', async () => {
    const file = path.join(testDir, 'persistence-test.json');
    const store1 = new JsonContextStore(file);
    await store1.connect();

    const ctx = createCanonicalContext({
      content: { text: 'Persisted across store instances' },
      type: 'rule',
      scope: 'workspace:1',
    });
    await store1.put(ctx);
    await store1.disconnect();

    // Verify raw file exists and contains valid JSON
    const content = await fs.readFile(file, 'utf8');
    expect(JSON.parse(content)).toHaveLength(1);

    // New instance loads from file
    const store2 = new JsonContextStore(file);
    await store2.connect();
    const retrieved = await store2.get(ctx.id, 'default');
    expect(retrieved).toBeDefined();
    expect(retrieved!.content.text).toBe('Persisted across store instances');
    expect(retrieved!.type).toBe('rule');
    await store2.disconnect();
  });
});

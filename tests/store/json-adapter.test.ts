import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createJsonAdapter } from '../../src/store/adapters/json.js';
import { parseDsn } from '../../src/store/dsn.js';
import { runStoreConformance } from './conformance.js';
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'fs';

let dir: string;

runStoreConformance('json', {
  async setup() {
    dir = join(tmpdir(), `opencontext-json-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
  },
  async create() {
    const adapter = createJsonAdapter(parseDsn(join(dir, 'contexts.json')));
    await adapter.connect();
    return adapter;
  },
  async teardown() {
    rmSync(dir, { recursive: true, force: true });
  },
});

// ---------------------------------------------------------------------------
// Behaviour specific to the file-backed adapter, carried over from the original
// store tests that the conformance suite does not cover.
// ---------------------------------------------------------------------------

describe('json adapter — file handling', () => {
  const created: string[] = [];

  afterEach(() => {
    for (const path of created.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('creates parent directories that do not exist yet', async () => {
    const root = join(tmpdir(), `opencontext-json-nested-${randomUUID()}`);
    created.push(root);
    const file = join(root, 'deeply', 'nested', 'contexts.json');

    const adapter = createJsonAdapter(parseDsn(file));
    await adapter.connect();
    await adapter.saveContext('needs a directory');
    await adapter.close();

    expect(existsSync(file)).toBe(true);
  });

  it('treats a missing store file as an empty store rather than an error', async () => {
    const root = join(tmpdir(), `opencontext-json-missing-${randomUUID()}`);
    created.push(root);

    const adapter = createJsonAdapter(parseDsn(join(root, 'contexts.json')));
    await adapter.connect();
    expect(await adapter.listContexts()).toEqual([]);
    expect(await adapter.listBubbles()).toEqual([]);
    await adapter.close();
  });

  it('migrates a store written before bubbles existed', async () => {
    const root = join(tmpdir(), `opencontext-json-legacy-${randomUUID()}`);
    created.push(root);
    mkdirSync(root, { recursive: true });
    const file = join(root, 'contexts.json');
    // A v1 store had no `bubbles` key at all.
    writeFileSync(file, JSON.stringify({ version: 1, entries: [] }), 'utf-8');

    const adapter = createJsonAdapter(parseDsn(file));
    await adapter.connect();
    expect(await adapter.listBubbles()).toEqual([]);
    await adapter.close();
  });
});

import { describe, it } from 'vitest';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createStore } from '../../src/store/index.js';
import type { ContextStoreAdapter } from '../../src/store/types.js';
import { runStoreConformance } from './conformance.js';

/**
 * Conformance runs for every backend that needs something running.
 *
 * Each block is skipped unless its connection string is in the environment, so
 * `npm test` stays green on a machine with no databases while
 * `docker compose -f docker-compose.test.yml up -d` plus `npm run test:backends`
 * exercises all of them for real.
 *
 * See docker-compose.test.yml for connection strings that work out of the box.
 */

/** Remove every row through the public API — the one wipe that works everywhere. */
async function wipe(adapter: ContextStoreAdapter): Promise<void> {
  for (const bubble of await adapter.listBubbles()) {
    await adapter.deleteBubble(bubble.id, true);
  }
  for (const entry of await adapter.listContexts()) {
    await adapter.deleteContext(entry.id);
  }
}

/**
 * Register a conformance run against a live service.
 *
 * The store is opened once per test and wiped first, because these backends are
 * shared and persistent — unlike the temp-file adapters, which get a fresh path.
 */
function describeBackend(name: string, url: string | undefined): void {
  if (!url) {
    describe.skip(`${name} — store conformance (set the connection string to run)`, () => {
      it('skipped', () => {});
    });
    return;
  }

  runStoreConformance(name, {
    async setup() {
      const adapter = await createStore(url);
      await wipe(adapter);
      await adapter.close();
    },
    async create() {
      return createStore(url);
    },
    async teardown() {
      const adapter = await createStore(url);
      await wipe(adapter);
      await adapter.close();
    },
  });
}

// ---------------------------------------------------------------------------
// Embedded backends that need a driver installed but no running service
// ---------------------------------------------------------------------------

const duckdbDir = join(tmpdir(), `opencontext-duckdb-${randomUUID()}`);

if (process.env.OPENCONTEXT_TEST_DUCKDB === '1') {
  runStoreConformance('duckdb', {
    async setup() {
      mkdirSync(duckdbDir, { recursive: true });
    },
    async create() {
      return createStore(`duckdb://${join(duckdbDir, 'oc.duckdb')}`);
    },
    async teardown() {
      rmSync(duckdbDir, { recursive: true, force: true });
    },
  });
} else {
  describe.skip('duckdb — store conformance (set OPENCONTEXT_TEST_DUCKDB=1 to run)', () => {
    it('skipped', () => {});
  });
}

// ---------------------------------------------------------------------------
// In-memory — no service, no driver; proves the shared document adapter
// ---------------------------------------------------------------------------

let memoryStore: string;

runStoreConformance('memory', {
  async setup() {
    memoryStore = `test-${randomUUID()}`;
  },
  async create() {
    return createStore(`memory://${memoryStore}`);
  },
  async teardown() {
    const { resetMemoryStore } = await import('../../src/store/drivers/memory.js');
    resetMemoryStore(memoryStore);
  },
});

// ---------------------------------------------------------------------------
// Backends that need a running service
// ---------------------------------------------------------------------------

describeBackend('postgres', process.env.OPENCONTEXT_TEST_POSTGRES_URL);
describeBackend('mysql', process.env.OPENCONTEXT_TEST_MYSQL_URL);
describeBackend('mssql', process.env.OPENCONTEXT_TEST_MSSQL_URL);
describeBackend('mongodb', process.env.OPENCONTEXT_TEST_MONGODB_URL);
describeBackend('redis', process.env.OPENCONTEXT_TEST_REDIS_URL);
describeBackend('surrealdb', process.env.OPENCONTEXT_TEST_SURREALDB_URL);
describeBackend('dynamodb', process.env.OPENCONTEXT_TEST_DYNAMODB_URL);
describeBackend('libsql', process.env.OPENCONTEXT_TEST_LIBSQL_URL);

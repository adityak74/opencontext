import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createSqliteDriver } from '../../src/store/drivers/sqlite.js';
import { createSqlAdapter } from '../../src/store/adapters/sql.js';
import { parseDsn } from '../../src/store/dsn.js';
import { runStoreConformance } from './conformance.js';

let dir: string;

// SQLite runs unconditionally: `node:sqlite` is built into Node, so this gives
// the shared SQL adapter real coverage with no external service.
runStoreConformance('sqlite', {
  async setup() {
    dir = join(tmpdir(), `opencontext-sqlite-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
  },
  async create() {
    const dsn = parseDsn(`sqlite://${join(dir, 'oc.db')}`);
    const driver = await createSqliteDriver(dsn);
    const adapter = createSqlAdapter(driver, {
      scheme: 'sqlite',
      label: 'SQLite',
      target: dsn.path!,
      remote: false,
    });
    await adapter.connect();
    return adapter;
  },
  async teardown() {
    rmSync(dir, { recursive: true, force: true });
  },
});

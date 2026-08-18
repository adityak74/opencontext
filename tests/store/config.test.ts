import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  resolveDatabase,
  writeDatabaseUrl,
  readConfig,
  clearDatabaseUrl,
  getConfigPath,
} from '../../src/store/config.js';

describe('database configuration', () => {
  let dir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    dir = join(tmpdir(), `opencontext-config-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    process.env.OPENCONTEXT_CONFIG_PATH = join(dir, 'config.json');
    delete process.env.OPENCONTEXT_DB_URL;
    delete process.env.OPENCONTEXT_STORE_PATH;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  describe('resolveDatabase precedence', () => {
    it('defaults to the JSON store in the home directory', () => {
      const resolved = resolveDatabase();
      expect(resolved.source).toBe('default');
      expect(resolved.url.startsWith('json://')).toBe(true);
      expect(resolved.url).toContain('contexts.json');
    });

    it('maps the legacy store path onto the JSON adapter', () => {
      process.env.OPENCONTEXT_STORE_PATH = '/custom/contexts.json';
      const resolved = resolveDatabase();
      expect(resolved.source).toBe('legacy-store-path');
      expect(resolved.url).toBe('json:///custom/contexts.json');
    });

    it('prefers the config file over the legacy path', () => {
      process.env.OPENCONTEXT_STORE_PATH = '/custom/contexts.json';
      writeDatabaseUrl('sqlite:///data/oc.db');
      expect(resolveDatabase().source).toBe('config-file');
    });

    it('lets the environment override the config file', () => {
      writeDatabaseUrl('sqlite:///data/oc.db');
      process.env.OPENCONTEXT_DB_URL = 'postgres://localhost:5432/oc';
      const resolved = resolveDatabase();
      expect(resolved.source).toBe('env');
      expect(resolved.url).toBe('postgres://localhost:5432/oc');
    });

    it('locks the value when it comes from the environment', () => {
      process.env.OPENCONTEXT_DB_URL = 'postgres://localhost:5432/oc';
      expect(resolveDatabase().locked).toBe(true);
    });

    it('leaves the value editable when it comes from the config file', () => {
      writeDatabaseUrl('sqlite:///data/oc.db');
      expect(resolveDatabase().locked).toBe(false);
    });

    it('redacts credentials in the reported value', () => {
      process.env.OPENCONTEXT_DB_URL = 'postgres://user:hunter2@host:5432/oc';
      const resolved = resolveDatabase();
      expect(resolved.redacted).not.toContain('hunter2');
      expect(resolved.redacted).toContain('***');
    });
  });

  describe('writeDatabaseUrl', () => {
    it('persists the url', () => {
      writeDatabaseUrl('postgres://localhost:5432/oc');
      expect(readConfig().database?.url).toBe('postgres://localhost:5432/oc');
    });

    it('writes the file with owner-only permissions', () => {
      writeDatabaseUrl('postgres://user:secret@host:5432/oc');
      // Connection strings carry passwords, so the file must not be world-readable.
      expect(statSync(getConfigPath()).mode & 0o777).toBe(0o600);
    });

    it('overwrites a previous value', () => {
      writeDatabaseUrl('sqlite:///a.db');
      writeDatabaseUrl('sqlite:///b.db');
      expect(readConfig().database?.url).toBe('sqlite:///b.db');
    });
  });

  describe('clearDatabaseUrl', () => {
    it('falls back to the default once cleared', () => {
      writeDatabaseUrl('sqlite:///data/oc.db');
      clearDatabaseUrl();
      expect(resolveDatabase().source).toBe('default');
    });

    it('is a no-op when no config exists', () => {
      expect(() => clearDatabaseUrl()).not.toThrow();
    });
  });

  describe('readConfig', () => {
    it('falls back to defaults rather than throwing on a corrupt file', () => {
      writeFileSync(getConfigPath(), '{ not valid json');
      expect(readConfig().database).toBeUndefined();
      expect(resolveDatabase().source).toBe('default');
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { parseDsn, ContextStoreRegistry, InvalidDsnError, UnsupportedSchemeError } from '../src/index.js';
import { MemoryContextStore } from '../src/base/memory-store.js';

describe('Provider SDK - DSN Parser & Registry', () => {
  describe('parseDsn', () => {
    it('parses valid DSN without parameters', () => {
      const parsed = parseDsn('memory://');
      expect(parsed.scheme).toBe('memory');
      expect(parsed.path).toBe('');
      expect(parsed.params).toEqual({});
      expect(parsed.raw).toBe('memory://');
    });

    it('parses DSN with path', () => {
      const parsed = parseDsn('json://tmp/test.json');
      expect(parsed.scheme).toBe('json');
      expect(parsed.path).toBe('tmp/test.json');
      expect(parsed.params).toEqual({});
    });

    it('parses DSN with query parameters', () => {
      const parsed = parseDsn('sqlite:///tmp/db.sqlite?cache=shared&mode=rwc');
      expect(parsed.scheme).toBe('sqlite');
      expect(parsed.path).toBe('/tmp/db.sqlite');
      expect(parsed.params).toEqual({
        cache: 'shared',
        mode: 'rwc',
      });
    });

    it('throws InvalidDsnError for invalid DSN strings', () => {
      expect(() => parseDsn('not-a-dsn')).toThrow(InvalidDsnError);
      expect(() => parseDsn('')).toThrow(InvalidDsnError);
      expect(() => parseDsn('://empty-scheme')).toThrow(InvalidDsnError);
    });
  });

  describe('ContextStoreRegistry', () => {
    beforeEach(() => {
      ContextStoreRegistry.clear();
    });

    it('registers and creates a store from a scheme', async () => {
      let connectCalled = false;
      class CustomStore extends MemoryContextStore {
        override readonly id = 'custom';
        override async connect() {
          connectCalled = true;
        }
      }

      ContextStoreRegistry.register('custom', async (parsed) => {
        expect(parsed.scheme).toBe('custom');
        return new CustomStore();
      });

      expect(ContextStoreRegistry.getRegisteredSchemes()).toContain('custom');

      const store = await ContextStoreRegistry.create('custom://my-instance');
      expect(store.id).toBe('custom');
      expect(connectCalled).toBe(true);
    });

    it('throws UnsupportedSchemeError when scheme is not registered', async () => {
      await expect(ContextStoreRegistry.create('unregistered://foo')).rejects.toThrow(UnsupportedSchemeError);
    });

    it('is case-insensitive for scheme names', async () => {
      ContextStoreRegistry.register('MEM', async () => new MemoryContextStore());
      const store = await ContextStoreRegistry.create('mem://');
      expect(store.id).toBe('memory');
    });
  });
});

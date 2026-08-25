import { describe } from 'vitest';
import { MemoryContextStore } from '../src/base/memory-store.js';
import { runProviderConformanceSuite } from '../src/testing/conformance.js';

describe('MemoryContextStore', () => {
  runProviderConformanceSuite('MemoryContextStore', {
    create: async () => new MemoryContextStore(),
  });
});

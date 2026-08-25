import { describe, it, expect } from 'vitest';

describe('@opencontext/core smoke test', () => {
  it('resolves the core module root', async () => {
    const core = await import('../src/index.js');
    expect(core.VERSION).toBe('2.0.0');
  });
});

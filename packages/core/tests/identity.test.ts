import { describe, it, expect } from 'vitest';
import { generateUlid, computeContentHash } from '../src/identity/index.js';

describe('Identity & Hashing', () => {
  it('generates a valid 26-character monotonic ULID', () => {
    const id1 = generateUlid();
    const id2 = generateUlid();
    expect(id1).toHaveLength(26);
    expect(id2).toHaveLength(26);
    expect(id1 < id2).toBe(true);
  });

  it('generates strictly monotonic ULIDs within the same millisecond', () => {
    const now = Date.now();
    const ids = Array.from({ length: 50 }, () => generateUlid(now));
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i - 1] < ids[i]).toBe(true);
    }
  });

  it('computes deterministic SHA-256 hash for strings and structured objects', () => {
    const textHash = computeContentHash('hello world');
    expect(textHash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');

    const objHash1 = computeContentHash({ a: 1, b: 2 });
    const objHash2 = computeContentHash({ b: 2, a: 1 });
    expect(objHash1).toBe(objHash2);
  });

  it('computes canonical hash for nested objects and arrays', () => {
    const nested1 = computeContentHash({ x: [1, 2], y: { b: 'two', a: 'one' } });
    const nested2 = computeContentHash({ y: { a: 'one', b: 'two' }, x: [1, 2] });
    expect(nested1).toBe(nested2);
  });
});

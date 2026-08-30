import { createHash } from 'node:crypto';

function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJson).join(',')}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson((obj as Record<string, unknown>)[k])}`);
  return `{${pairs.join(',')}}`;
}

export function computeContentHash(content: string | Record<string, unknown>): string {
  const serialized = typeof content === 'string' ? content : canonicalizeJson(content);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

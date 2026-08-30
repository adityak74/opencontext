import { describe, it, expect } from 'vitest';
import { createCanonicalContext } from '../src/model/factory.js';

describe('CanonicalContext Model', () => {
  it('creates a fully formed CanonicalContext entity with defaults', () => {
    const context = createCanonicalContext({
      content: { text: 'Authentication design pattern' },
      type: 'decision',
      scope: 'project:zorp',
    });

    expect(context.id).toHaveLength(26);
    expect(context.namespace).toBe('default');
    expect(context.scope).toBe('project:zorp');
    expect(context.type).toBe('decision');
    expect(context.content.text).toBe('Authentication design pattern');
    expect(context.provenance.actor).toBe('user');
    expect(context.provenance.contentHash).toBeTruthy();
    expect(context.version.revision).toBe(1);
    expect(context.lifecycle).toBe('active');
    expect(context.relationships).toEqual([]);
    expect(context.timestamps.createdAt).toBeTruthy();
    expect(context.timestamps.updatedAt).toBe(context.timestamps.createdAt);
  });

  it('respects custom overrides for all fields', () => {
    const customId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const expires = new Date(Date.now() + 60000).toISOString();
    const context = createCanonicalContext({
      id: customId,
      namespace: 'custom-ns',
      scope: 'custom-scope',
      type: 'constraint',
      content: { structured: { maxMemoryMb: 512 } },
      metadata: { priority: 'high' },
      actor: 'agent',
      agentId: 'agent-007',
      sourceUri: 'file:///config.json',
      relationships: [{ targetId: '01ARZ3NDEKTSV4RRFFQ69G5FA0', relation: 'derived_from' }],
      expiresAt: expires,
    });

    expect(context.id).toBe(customId);
    expect(context.namespace).toBe('custom-ns');
    expect(context.scope).toBe('custom-scope');
    expect(context.type).toBe('constraint');
    expect(context.content.structured).toEqual({ maxMemoryMb: 512 });
    expect(context.metadata).toEqual({ priority: 'high' });
    expect(context.provenance.actor).toBe('agent');
    expect(context.provenance.agentId).toBe('agent-007');
    expect(context.provenance.sourceUri).toBe('file:///config.json');
    expect(context.provenance.contentHash).toBeTruthy();
    expect(context.relationships).toHaveLength(1);
    expect(context.relationships[0].relation).toBe('derived_from');
    expect(context.timestamps.expiresAt).toBe(expires);
  });
});

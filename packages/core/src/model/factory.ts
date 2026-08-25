import { CanonicalContext, ContextType, ScopeId, NamespaceId, LifecycleState } from './types.js';
import { generateUlid } from '../identity/ulid.js';
import { computeContentHash } from '../identity/hash.js';

export interface CreateContextOptions {
  id?: string;
  namespace?: NamespaceId;
  scope?: ScopeId;
  type?: ContextType;
  lifecycle?: LifecycleState;
  content: {
    text?: string;
    structured?: Record<string, unknown>;
    mediaType?: string;
    embedding?: number[];
  };
  metadata?: Record<string, unknown>;
  actor?: 'user' | 'agent' | 'system' | 'integration';
  agentId?: string;
  sourceUri?: string;
  relationships?: CanonicalContext['relationships'];
  expiresAt?: string;
}

export function createCanonicalContext(opts: CreateContextOptions): CanonicalContext {
  const now = new Date().toISOString();
  const hashInput = opts.content.text ?? opts.content.structured ?? {};

  return {
    id: opts.id ?? generateUlid(),
    namespace: opts.namespace ?? 'default',
    scope: opts.scope ?? 'global',
    type: opts.type ?? 'fact',
    content: opts.content,
    metadata: opts.metadata ?? {},
    provenance: {
      actor: opts.actor ?? 'user',
      agentId: opts.agentId,
      sourceUri: opts.sourceUri,
      contentHash: computeContentHash(hashInput),
    },
    relationships: opts.relationships ?? [],
    timestamps: {
      createdAt: now,
      updatedAt: now,
      expiresAt: opts.expiresAt,
    },
    version: {
      revision: 1,
    },
    lifecycle: opts.lifecycle ?? 'active',
  };
}

export type ContextId = string;
export type NamespaceId = string;
export type ScopeId = string;

export type ContextType =
  | 'message'
  | 'fact'
  | 'decision'
  | 'constraint'
  | 'preference'
  | 'artifact'
  | 'observation'
  | 'tool_result'
  | 'summary'
  | 'checkpoint'
  | (string & {});

export type LifecycleState = 'active' | 'archived' | 'deprecated' | 'soft_deleted' | 'pinned';

export interface RelationshipEdge {
  targetId: ContextId;
  relation: 'supersedes' | 'derived_from' | 'references' | 'child_of' | 'caused_by' | string;
  metadata?: Record<string, unknown>;
}

export interface ContextProvenance {
  actor: 'user' | 'agent' | 'system' | 'integration';
  agentId?: string;
  model?: string;
  sourceUri?: string;
  signature?: string;
  contentHash: string;
  derivationChain?: ContextId[];
}

export interface ContextTimestamps {
  createdAt: string;
  updatedAt: string;
  accessedAt?: string;
  expiresAt?: string;
}

export interface CanonicalContext {
  id: ContextId;
  namespace: NamespaceId;
  scope: ScopeId;
  type: ContextType;
  content: {
    text?: string;
    structured?: Record<string, unknown>;
    mediaType?: string;
    embedding?: number[];
  };
  metadata: Record<string, unknown>;
  provenance: ContextProvenance;
  relationships: RelationshipEdge[];
  timestamps: ContextTimestamps;
  version: {
    revision: number;
    clock?: Record<string, number>;
  };
  lifecycle: LifecycleState;
}

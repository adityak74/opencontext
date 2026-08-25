import type { CanonicalContext, ContextId, ContextType, LifecycleState, NamespaceId, ScopeId } from '@opencontext/core';

export interface ContextStoreCapabilities {
  fullTextSearch: boolean;
  vectorSearch: boolean;
  graphTraversal: boolean;
  atomicTransactions: boolean;
  optimisticLocking: boolean;
  nativeTtl: boolean;
  changeStreams: boolean;
  durableCursors: boolean;
}

export interface ContextQuery {
  namespace: NamespaceId;
  scope?: ScopeId | ScopeId[];
  types?: ContextType[];
  lifecycle?: LifecycleState[];
  filter?: Record<string, unknown>;
  fullText?: string;
  vector?: {
    embedding: number[];
    topK: number;
    minSimilarity?: number;
  };
  relationships?: {
    relatedTo: ContextId;
    relation?: string;
    depth?: number;
  };
  pagination?: {
    limit: number;
    cursor?: string;
    order?: 'asc' | 'desc';
    orderBy?: 'createdAt' | 'updatedAt' | 'revision';
  };
}

export interface ContextBatchMutation {
  puts?: CanonicalContext[];
  updates?: Array<{ id: ContextId; expectedRevision: number; patch: Partial<CanonicalContext> }>;
  deletes?: ContextId[];
}

export interface ContextStore {
  readonly id: string;
  readonly capabilities: ContextStoreCapabilities;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<void>;

  put(context: CanonicalContext): Promise<CanonicalContext>;
  get(id: ContextId, namespace?: NamespaceId): Promise<CanonicalContext | undefined>;
  query(query: ContextQuery): Promise<{ items: CanonicalContext[]; nextCursor?: string; totalCount?: number }>;
  update(id: ContextId, namespace: NamespaceId, expectedRevision: number, patch: Partial<CanonicalContext>): Promise<CanonicalContext>;
  delete(id: ContextId, namespace?: NamespaceId, hard?: boolean): Promise<boolean>;
  batch(mutation: ContextBatchMutation): Promise<{ applied: boolean; committedRevision: number }>;
}

import type { ContextEntry, Bubble } from '../mcp/types.js';

export type { ContextEntry, Bubble };

/** Every connection-string scheme opencontext knows how to open. */
export type DbScheme =
  // file / embedded
  | 'json'
  | 'memory'
  | 'sqlite'
  | 'duckdb'
  // SQL over the wire
  | 'libsql'
  | 'd1'
  | 'postgres'
  | 'cloudsql'
  | 'mysql'
  | 'mssql'
  // document / key-value
  | 'mongodb'
  | 'redis'
  | 'firestore'
  | 'dynamodb'
  // multi-model
  | 'surrealdb';

/** Describes the live backend. `target` is always redacted — it is sent to the UI. */
export interface AdapterInfo {
  scheme: DbScheme;
  label: string;
  target: string;
  remote: boolean;
}

/**
 * The storage contract. Method signatures mirror the original synchronous JSON
 * store; only the return types changed, so call sites just gained an `await`.
 *
 * Ordering contract: every list-returning method orders by `createdAt` ascending,
 * then `id` ascending. This is identical across all adapters.
 */
export interface ContextStoreAdapter {
  readonly info: AdapterInfo;

  connect(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<void>;

  saveContext(
    content: string,
    tags?: string[],
    source?: string,
    bubbleId?: string,
  ): Promise<ContextEntry>;
  recallContext(query: string): Promise<ContextEntry[]>;
  listContexts(tag?: string): Promise<ContextEntry[]>;
  listContextsByBubble(bubbleId: string): Promise<ContextEntry[]>;
  getContext(id: string): Promise<ContextEntry | undefined>;
  updateContext(
    id: string,
    content: string,
    tags?: string[],
    bubbleId?: string | null,
  ): Promise<ContextEntry | undefined>;
  deleteContext(id: string): Promise<boolean>;
  searchContexts(query: string): Promise<ContextEntry[]>;

  createBubble(name: string, description?: string): Promise<Bubble>;
  listBubbles(): Promise<Bubble[]>;
  getBubble(id: string): Promise<Bubble | undefined>;
  updateBubble(id: string, name: string, description?: string): Promise<Bubble | undefined>;
  deleteBubble(id: string, deleteContexts?: boolean): Promise<boolean>;
}

/** Raised when a DSN names an adapter whose optional driver is not installed. */
export class DriverNotInstalledError extends Error {
  constructor(
    public readonly scheme: DbScheme,
    public readonly packageName: string,
    public readonly reason?: unknown,
  ) {
    super(
      `${scheme} driver is not installed.\nInstall it with:  npm install ${packageName}`,
    );
    this.name = 'DriverNotInstalledError';
  }
}

/** Raised for malformed or unsupported connection strings. */
export class InvalidDsnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDsnError';
  }
}

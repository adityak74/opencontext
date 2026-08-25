import type { CanonicalContext, ContextId, NamespaceId } from '@opencontext/core';
import type { ContextStore, ContextStoreCapabilities, ContextQuery, ContextBatchMutation } from '../spi.js';
import type { SqlDialect } from './sql-dialects.js';
import { ConcurrencyConflictError } from '../errors.js';

export interface SqlDriver {
  query(sql: string, params?: any[]): Promise<any[]>;
  exec(sql: string, params?: any[]): Promise<{ changes: number }>;
  close(): Promise<void>;
}

export class SqlContextStore implements ContextStore {
  readonly capabilities: ContextStoreCapabilities = {
    fullTextSearch: true,
    vectorSearch: false,
    graphTraversal: true,
    atomicTransactions: true,
    optimisticLocking: true,
    nativeTtl: false,
    changeStreams: false,
    durableCursors: false,
  };

  constructor(
    readonly id: string,
    private readonly dialect: SqlDialect,
    private readonly driver: SqlDriver,
  ) {}

  async connect(): Promise<void> {
    const statements = this.dialect
      .createTableSql()
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await this.driver.exec(stmt);
    }
  }

  async disconnect(): Promise<void> {
    await this.driver.close();
  }

  async ping(): Promise<void> {
    await this.driver.query('SELECT 1');
  }

  private rowToContext(row: any): CanonicalContext {
    return {
      id: row.id,
      namespace: row.namespace,
      scope: row.scope,
      type: row.type,
      content: typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json,
      metadata: typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json,
      provenance: typeof row.provenance_json === 'string' ? JSON.parse(row.provenance_json) : row.provenance_json,
      relationships: typeof row.relationships_json === 'string' ? JSON.parse(row.relationships_json) : row.relationships_json,
      timestamps: {
        createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(row.updated_at).toISOString(),
      },
      version: {
        revision: Number(row.revision),
      },
      lifecycle: row.lifecycle,
    };
  }

  async put(ctx: CanonicalContext): Promise<CanonicalContext> {
    const p = (i: number) => this.dialect.placeholder(i);
    const sql = `
      INSERT INTO contexts (id, namespace, scope, type, content_json, metadata_json, provenance_json, relationships_json, created_at, updated_at, revision, lifecycle)
      VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)})
    `;
    const params = [
      ctx.id,
      ctx.namespace,
      ctx.scope,
      ctx.type,
      JSON.stringify(ctx.content ?? {}),
      JSON.stringify(ctx.metadata ?? {}),
      JSON.stringify(ctx.provenance ?? {}),
      JSON.stringify(ctx.relationships ?? []),
      typeof ctx.timestamps.createdAt === 'string' ? ctx.timestamps.createdAt : new Date(ctx.timestamps.createdAt).toISOString(),
      typeof ctx.timestamps.updatedAt === 'string' ? ctx.timestamps.updatedAt : new Date(ctx.timestamps.updatedAt).toISOString(),
      ctx.version.revision,
      ctx.lifecycle,
    ];
    await this.driver.exec(sql, params);
    return ctx;
  }

  async get(id: ContextId, namespace: NamespaceId = 'default'): Promise<CanonicalContext | undefined> {
    const p = (i: number) => this.dialect.placeholder(i);
    const rows = await this.driver.query(
      `SELECT * FROM contexts WHERE id = ${p(1)} AND namespace = ${p(2)}`,
      [id, namespace],
    );
    if (!rows || rows.length === 0) return undefined;
    return this.rowToContext(rows[0]);
  }

  async query(q: ContextQuery): Promise<{ items: CanonicalContext[]; nextCursor?: string; totalCount?: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    conditions.push(`namespace = ${this.dialect.placeholder(idx++)}`);
    params.push(q.namespace);

    if (q.scope) {
      const scopes = Array.isArray(q.scope) ? q.scope : [q.scope];
      if (scopes.length > 0) {
        const placeholders = scopes.map(() => this.dialect.placeholder(idx++)).join(', ');
        conditions.push(`scope IN (${placeholders})`);
        params.push(...scopes);
      }
    }

    if (q.types && q.types.length > 0) {
      const placeholders = q.types.map(() => this.dialect.placeholder(idx++)).join(', ');
      conditions.push(`type IN (${placeholders})`);
      params.push(...q.types);
    }

    if (q.lifecycle && q.lifecycle.length > 0) {
      const placeholders = q.lifecycle.map(() => this.dialect.placeholder(idx++)).join(', ');
      conditions.push(`lifecycle IN (${placeholders})`);
      params.push(...q.lifecycle);
    }

    if (q.fullText) {
      const terms = q.fullText.trim().split(/\s+/).filter(Boolean);
      for (const term of terms) {
        conditions.push(`content_json LIKE ${this.dialect.placeholder(idx++)}`);
        params.push(`%${term}%`);
      }
    }

    const orderCol = q.pagination?.orderBy === 'revision'
      ? 'revision'
      : q.pagination?.orderBy === 'updatedAt'
      ? 'updated_at'
      : 'created_at';
    const orderDir = q.pagination?.order === 'desc' ? 'DESC' : 'ASC';
    const limit = q.pagination?.limit ?? 100;

    const sql = `
      SELECT * FROM contexts
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderCol} ${orderDir}, id ASC
      LIMIT ${limit}
    `;

    const rows = await this.driver.query(sql, params);
    const items = rows.map((r) => this.rowToContext(r));
    return { items, totalCount: items.length };
  }

  async update(
    id: ContextId,
    namespace: NamespaceId = 'default',
    expectedRevision: number,
    patch: Partial<CanonicalContext>,
  ): Promise<CanonicalContext> {
    const existing = await this.get(id, namespace);
    if (!existing) {
      throw new Error(`Context '${id}' not found`);
    }
    if (existing.version.revision !== expectedRevision) {
      throw new ConcurrencyConflictError(id, expectedRevision, existing.version.revision);
    }

    const newRev = expectedRevision + 1;
    const now = new Date().toISOString();
    const updatedCtx: CanonicalContext = {
      ...existing,
      ...patch,
      id,
      namespace,
      version: {
        ...existing.version,
        ...(patch.version ?? {}),
        revision: newRev,
      },
      timestamps: {
        ...existing.timestamps,
        ...(patch.timestamps ?? {}),
        updatedAt: now,
      },
    };

    const p = (i: number) => this.dialect.placeholder(i);
    const sql = `
      UPDATE contexts
      SET content_json = ${p(1)}, metadata_json = ${p(2)}, provenance_json = ${p(3)}, relationships_json = ${p(4)},
          updated_at = ${p(5)}, revision = ${p(6)}, lifecycle = ${p(7)}, scope = ${p(8)}, type = ${p(9)}
      WHERE id = ${p(10)} AND namespace = ${p(11)} AND revision = ${p(12)}
    `;

    const res = await this.driver.exec(sql, [
      JSON.stringify(updatedCtx.content ?? {}),
      JSON.stringify(updatedCtx.metadata ?? {}),
      JSON.stringify(updatedCtx.provenance ?? {}),
      JSON.stringify(updatedCtx.relationships ?? []),
      updatedCtx.timestamps.updatedAt,
      newRev,
      updatedCtx.lifecycle,
      updatedCtx.scope,
      updatedCtx.type,
      id,
      namespace,
      expectedRevision,
    ]);

    if (res.changes === 0) {
      const current = await this.get(id, namespace);
      throw new ConcurrencyConflictError(id, expectedRevision, current?.version.revision ?? -1);
    }

    return updatedCtx;
  }

  async delete(id: ContextId, namespace: NamespaceId = 'default', hard = false): Promise<boolean> {
    const p = (i: number) => this.dialect.placeholder(i);
    if (hard) {
      const res = await this.driver.exec(
        `DELETE FROM contexts WHERE id = ${p(1)} AND namespace = ${p(2)}`,
        [id, namespace],
      );
      return res.changes > 0;
    } else {
      const existing = await this.get(id, namespace);
      if (!existing) return false;
      const res = await this.driver.exec(
        `UPDATE contexts SET lifecycle = 'soft_deleted', updated_at = ${p(1)} WHERE id = ${p(2)} AND namespace = ${p(3)}`,
        [new Date().toISOString(), id, namespace],
      );
      return res.changes > 0;
    }
  }

  async batch(mutation: ContextBatchMutation): Promise<{ applied: boolean; committedRevision: number }> {
    if (mutation.puts) {
      for (const p of mutation.puts) await this.put(p);
    }
    if (mutation.updates) {
      for (const u of mutation.updates) {
        await this.update(u.id, u.patch.namespace ?? 'default', u.expectedRevision, u.patch);
      }
    }
    if (mutation.deletes) {
      for (const d of mutation.deletes) {
        await this.delete(d, 'default', true);
      }
    }
    return { applied: true, committedRevision: 1 };
  }
}

export interface SqlDialect {
  readonly name: string;
  createTableSql(): string;
  placeholder(index: number): string;
}

export class SqliteDialect implements SqlDialect {
  readonly name = 'sqlite';
  createTableSql(): string {
    return `
      CREATE TABLE IF NOT EXISTS contexts (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        scope TEXT NOT NULL,
        type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        relationships_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        revision INTEGER NOT NULL,
        lifecycle TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_contexts_query ON contexts(namespace, scope, type, lifecycle);
    `;
  }
  placeholder(_index: number): string {
    return '?';
  }
}

export class PostgresDialect implements SqlDialect {
  readonly name = 'postgres';
  createTableSql(): string {
    return `
      CREATE TABLE IF NOT EXISTS contexts (
        id VARCHAR(64) PRIMARY KEY,
        namespace VARCHAR(128) NOT NULL,
        scope VARCHAR(256) NOT NULL,
        type VARCHAR(64) NOT NULL,
        content_json JSONB NOT NULL,
        metadata_json JSONB NOT NULL,
        provenance_json JSONB NOT NULL,
        relationships_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ,
        revision BIGINT NOT NULL,
        lifecycle VARCHAR(32) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pg_contexts ON contexts(namespace, scope, type, lifecycle);
    `;
  }
  placeholder(index: number): string {
    return `$${index}`;
  }
}

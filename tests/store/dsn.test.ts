import { describe, it, expect } from 'vitest';
import { parseDsn, redactDsn, SUPPORTED_SCHEMES } from '../../src/store/dsn.js';
import { InvalidDsnError } from '../../src/store/types.js';

describe('parseDsn', () => {
  describe('json', () => {
    it('parses an absolute file path', () => {
      const dsn = parseDsn('json:///home/me/.opencontext/contexts.json');
      expect(dsn.scheme).toBe('json');
      expect(dsn.path).toBe('/home/me/.opencontext/contexts.json');
      expect(dsn.remote).toBe(false);
    });

    it('treats a bare path with no scheme as json', () => {
      const dsn = parseDsn('/var/data/contexts.json');
      expect(dsn.scheme).toBe('json');
      expect(dsn.path).toBe('/var/data/contexts.json');
    });

    it('treats a relative path with no scheme as json', () => {
      const dsn = parseDsn('./local/contexts.json');
      expect(dsn.scheme).toBe('json');
      expect(dsn.path).toBe('./local/contexts.json');
    });
  });

  describe('sqlite', () => {
    it('parses a file path', () => {
      const dsn = parseDsn('sqlite:///data/oc.db');
      expect(dsn.scheme).toBe('sqlite');
      expect(dsn.path).toBe('/data/oc.db');
      expect(dsn.remote).toBe(false);
    });

    it('parses the in-memory form', () => {
      const dsn = parseDsn('sqlite::memory:');
      expect(dsn.scheme).toBe('sqlite');
      expect(dsn.path).toBe(':memory:');
    });
  });

  describe('libsql', () => {
    it('parses a remote host and auth token', () => {
      const dsn = parseDsn('libsql://db.turso.io?authToken=secret-token');
      expect(dsn.scheme).toBe('libsql');
      expect(dsn.host).toBe('db.turso.io');
      expect(dsn.params.authToken).toBe('secret-token');
      expect(dsn.remote).toBe(true);
    });
  });

  describe('postgres', () => {
    it('parses host, port, credentials and database', () => {
      const dsn = parseDsn('postgres://alice:hunter2@db.example.com:5432/opencontext');
      expect(dsn.scheme).toBe('postgres');
      expect(dsn.host).toBe('db.example.com');
      expect(dsn.port).toBe(5432);
      expect(dsn.username).toBe('alice');
      expect(dsn.password).toBe('hunter2');
      expect(dsn.database).toBe('opencontext');
      expect(dsn.remote).toBe(true);
    });

    it('accepts postgresql:// as an alias', () => {
      expect(parseDsn('postgresql://localhost/oc').scheme).toBe('postgres');
    });

    it('defaults the port to 5432', () => {
      expect(parseDsn('postgres://localhost/oc').port).toBe(5432);
    });

    it('rejects a postgres url with no database', () => {
      expect(() => parseDsn('postgres://localhost')).toThrow(InvalidDsnError);
    });
  });

  describe('duckdb', () => {
    it('parses a file path', () => {
      const dsn = parseDsn('duckdb:///data/oc.duckdb');
      expect(dsn.scheme).toBe('duckdb');
      expect(dsn.path).toBe('/data/oc.duckdb');
      expect(dsn.remote).toBe(false);
    });

    it('parses the in-memory form', () => {
      expect(parseDsn('duckdb::memory:').path).toBe(':memory:');
    });
  });

  describe('surrealdb', () => {
    it('parses credentials, namespace and database', () => {
      const dsn = parseDsn('surrealdb://root:root@127.0.0.1:8000/myns/mydb');
      expect(dsn.scheme).toBe('surrealdb');
      expect(dsn.host).toBe('127.0.0.1');
      expect(dsn.port).toBe(8000);
      expect(dsn.username).toBe('root');
      expect(dsn.password).toBe('root');
      expect(dsn.namespace).toBe('myns');
      expect(dsn.database).toBe('mydb');
      expect(dsn.remote).toBe(true);
    });

    it('accepts ws:// and wss:// aliases', () => {
      expect(parseDsn('ws://root:root@localhost:8000/ns/db').scheme).toBe('surrealdb');
      expect(parseDsn('wss://root:root@localhost:8000/ns/db').scheme).toBe('surrealdb');
    });

    it('builds an http endpoint for ws and a secure one for wss', () => {
      expect(parseDsn('ws://localhost:8000/ns/db').endpoint).toBe('http://localhost:8000');
      expect(parseDsn('wss://cloud.surreal.io/ns/db').endpoint).toBe('https://cloud.surreal.io');
    });

    it('rejects a surreal url missing the database segment', () => {
      expect(() => parseDsn('surrealdb://localhost:8000/onlyns')).toThrow(InvalidDsnError);
    });
  });

  describe('mssql / azure sql', () => {
    it('parses host, credentials and database', () => {
      const dsn = parseDsn('mssql://sa:Secret1@sql.example.com:1433/opencontext');
      expect(dsn.scheme).toBe('mssql');
      expect(dsn.host).toBe('sql.example.com');
      expect(dsn.port).toBe(1433);
      expect(dsn.username).toBe('sa');
      expect(dsn.password).toBe('Secret1');
      expect(dsn.database).toBe('opencontext');
      expect(dsn.remote).toBe(true);
    });

    it('defaults the port to 1433', () => {
      expect(parseDsn('mssql://host/db').port).toBe(1433);
    });

    it('accepts sqlserver:// and azuresql:// aliases', () => {
      expect(parseDsn('sqlserver://host/db').scheme).toBe('mssql');
      expect(parseDsn('azuresql://host/db').scheme).toBe('mssql');
    });

    it('decodes a percent-encoded Azure username containing @', () => {
      const dsn = parseDsn('mssql://admin%40myserver:pw@myserver.database.windows.net/oc');
      expect(dsn.username).toBe('admin@myserver');
    });

    it('carries the encrypt flag through as a param', () => {
      expect(parseDsn('mssql://host/db?encrypt=true').params.encrypt).toBe('true');
    });

    it('rejects an mssql url with no database', () => {
      expect(() => parseDsn('mssql://host')).toThrow(InvalidDsnError);
    });
  });

  describe('cloudsql', () => {
    it('parses the instance connection name and database', () => {
      const dsn = parseDsn('cloudsql://app:pw@my-proj:us-central1:my-inst/opencontext');
      expect(dsn.scheme).toBe('cloudsql');
      expect(dsn.instance).toBe('my-proj:us-central1:my-inst');
      expect(dsn.database).toBe('opencontext');
      expect(dsn.username).toBe('app');
      expect(dsn.password).toBe('pw');
      expect(dsn.remote).toBe(true);
    });

    it('allows credentials to be omitted for IAM auth', () => {
      const dsn = parseDsn('cloudsql://my-proj:us-central1:my-inst/opencontext');
      expect(dsn.instance).toBe('my-proj:us-central1:my-inst');
      expect(dsn.username).toBeUndefined();
    });

    it('carries query params through', () => {
      const dsn = parseDsn('cloudsql://p:r:i/db?ipType=PRIVATE');
      expect(dsn.params.ipType).toBe('PRIVATE');
    });

    it('rejects an instance name that is not project:region:instance', () => {
      expect(() => parseDsn('cloudsql://just-an-instance/db')).toThrow(/project:region:instance/);
      expect(() => parseDsn('cloudsql://proj:region/db')).toThrow(/project:region:instance/);
    });

    it('rejects a cloudsql url with no database', () => {
      expect(() => parseDsn('cloudsql://p:r:i')).toThrow(InvalidDsnError);
    });
  });

  describe('dynamodb', () => {
    it('parses region and table', () => {
      const dsn = parseDsn('dynamodb://us-east-1/opencontext');
      expect(dsn.scheme).toBe('dynamodb');
      expect(dsn.region).toBe('us-east-1');
      expect(dsn.table).toBe('opencontext');
      expect(dsn.remote).toBe(true);
    });

    it('accepts the ddb:// alias', () => {
      expect(parseDsn('ddb://eu-west-2/tbl').scheme).toBe('dynamodb');
    });

    it('carries a local endpoint override through as a param', () => {
      const dsn = parseDsn('dynamodb://us-east-1/oc?endpoint=http://localhost:8000');
      expect(dsn.params.endpoint).toBe('http://localhost:8000');
    });

    it('rejects a dynamodb url with no table', () => {
      expect(() => parseDsn('dynamodb://us-east-1')).toThrow(InvalidDsnError);
    });
  });

  describe('validation', () => {
    it('rejects an unknown scheme and names the supported ones', () => {
      expect(() => parseDsn('cassandra://localhost/oc')).toThrow(/Unsupported/);
      try {
        parseDsn('cassandra://localhost/oc');
      } catch (error) {
        expect((error as Error).message).toContain('postgres');
        expect((error as Error).message).toContain('mongodb');
      }
    });

    it('rejects an empty connection string', () => {
      expect(() => parseDsn('')).toThrow(InvalidDsnError);
      expect(() => parseDsn('   ')).toThrow(InvalidDsnError);
    });

    it('rejects a file-based scheme with no path', () => {
      expect(() => parseDsn('sqlite://')).toThrow(InvalidDsnError);
    });

    it('lists every supported scheme', () => {
      expect(SUPPORTED_SCHEMES).toEqual([
        'json', 'memory', 'sqlite', 'duckdb',
        'libsql', 'd1', 'postgres', 'cloudsql', 'mysql', 'mssql',
        'mongodb', 'redis', 'firestore', 'dynamodb', 'surrealdb',
      ]);
    });
  });
});

describe('canonical connection string', () => {
  it('rewrites an alias to the spelling the driver library accepts', () => {
    expect(parseDsn('mongo://host:27017/oc').canonical).toBe('mongodb://host:27017/oc');
    expect(parseDsn('valkey://host:6379').canonical).toBe('redis://host:6379');
    expect(parseDsn('postgresql://host/oc').canonical).toBe('postgres://host/oc');
  });

  it('lowercases a shouted scheme', () => {
    expect(parseDsn('MONGODB://host:27017/oc').canonical).toBe('mongodb://host:27017/oc');
  });

  it('preserves rediss:// so TLS is not silently downgraded', () => {
    // rediss is the TLS variant of redis. Collapsing it to the normalised
    // scheme would turn encryption off without telling anyone.
    expect(parseDsn('rediss://host:6379').canonical).toBe('rediss://host:6379');
  });

  it('preserves mongodb+srv:// so Atlas SRV lookup still happens', () => {
    expect(parseDsn('mongodb+srv://cluster.mongodb.net/oc').canonical).toBe(
      'mongodb+srv://cluster.mongodb.net/oc',
    );
  });

  it('leaves credentials and query params intact', () => {
    expect(parseDsn('mongo://u:p@host:27017/oc?retryWrites=true').canonical).toBe(
      'mongodb://u:p@host:27017/oc?retryWrites=true',
    );
  });

  it('leaves schemes with no alias untouched', () => {
    expect(parseDsn('mongodb://host/oc').canonical).toBe('mongodb://host/oc');
    expect(parseDsn('redis://host:6379').canonical).toBe('redis://host:6379');
  });

  it('is set for file-based schemes too', () => {
    expect(parseDsn('sqlite:///data/oc.db').canonical).toBe('sqlite:///data/oc.db');
    expect(parseDsn('/data/contexts.json').canonical).toBe('/data/contexts.json');
  });
});

describe('redactDsn', () => {
  it('masks the password', () => {
    expect(redactDsn('postgres://alice:hunter2@db.example.com:5432/oc'))
      .toBe('postgres://alice:***@db.example.com:5432/oc');
  });

  it('masks an auth token query parameter', () => {
    expect(redactDsn('libsql://db.turso.io?authToken=secret'))
      .toBe('libsql://db.turso.io?authToken=***');
  });

  it('leaves a url with no credentials untouched', () => {
    expect(redactDsn('postgres://localhost:5432/oc')).toBe('postgres://localhost:5432/oc');
  });

  it('leaves file paths untouched', () => {
    expect(redactDsn('sqlite:///data/oc.db')).toBe('sqlite:///data/oc.db');
    expect(redactDsn('/data/contexts.json')).toBe('/data/contexts.json');
  });

  it('returns unparseable input unchanged rather than throwing', () => {
    expect(redactDsn('not a url at all')).toBe('not a url at all');
  });
});

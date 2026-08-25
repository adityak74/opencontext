import { InvalidDsnError, UnsupportedSchemeError } from './errors.js';
import type { ContextStore } from './spi.js';

export interface ParsedDsn {
  scheme: string;
  host?: string;
  port?: number;
  path?: string;
  user?: string;
  password?: string;
  params: Record<string, string>;
  raw: string;
}

export function parseDsn(dsn: string): ParsedDsn {
  const match = dsn.match(/^([a-zA-Z0-9+_-]+):\/\/(.*)$/);
  if (!match) throw new InvalidDsnError(`Invalid DSN format: '${dsn}'`);

  const scheme = match[1].toLowerCase();
  const rest = match[2];

  let path = rest;
  const params: Record<string, string> = {};

  const qIndex = rest.indexOf('?');
  if (qIndex !== -1) {
    path = rest.slice(0, qIndex);
    const queryString = rest.slice(qIndex + 1);
    const searchParams = new URLSearchParams(queryString);
    searchParams.forEach((val, key) => {
      params[key] = val;
    });
  }

  return {
    scheme,
    path,
    params,
    raw: dsn,
  };
}

export type StoreFactory = (parsed: ParsedDsn) => Promise<ContextStore>;

export class ContextStoreRegistry {
  private static factories = new Map<string, StoreFactory>();

  static register(scheme: string, factory: StoreFactory): void {
    this.factories.set(scheme.toLowerCase(), factory);
  }

  static async create(dsn: string): Promise<ContextStore> {
    const parsed = parseDsn(dsn);
    const factory = this.factories.get(parsed.scheme);
    if (!factory) {
      throw new UnsupportedSchemeError(parsed.scheme);
    }
    const store = await factory(parsed);
    await store.connect();
    return store;
  }

  static clear(): void {
    this.factories.clear();
  }

  static getRegisteredSchemes(): string[] {
    return Array.from(this.factories.keys());
  }
}

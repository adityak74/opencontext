import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { redactDsn } from './dsn.js';

const CONFIG_VERSION = 1;

export interface StoredConfig {
  version: number;
  database?: { url: string };
}

export function getConfigPath(): string {
  return process.env.OPENCONTEXT_CONFIG_PATH ?? join(homedir(), '.opencontext', 'config.json');
}

export function getDefaultJsonPath(): string {
  return join(homedir(), '.opencontext', 'contexts.json');
}

export function readConfig(): StoredConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return { version: CONFIG_VERSION };
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as StoredConfig;
  } catch {
    // A corrupt config must not make opencontext unusable — fall back to the
    // default store and let the user fix or overwrite it from the settings page.
    return { version: CONFIG_VERSION };
  }
}

/**
 * Persist the connection string.
 *
 * The file is written with mode 0600 because a connection string routinely
 * carries a database password.
 */
export function writeDatabaseUrl(url: string): void {
  const path = getConfigPath();
  const directory = dirname(path);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const next: StoredConfig = { ...readConfig(), version: CONFIG_VERSION, database: { url } };
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  chmodSync(path, 0o600);
}

export function clearDatabaseUrl(): void {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return;
  }
  const next = readConfig();
  delete next.database;
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

export type ConfigSource = 'env' | 'config-file' | 'legacy-store-path' | 'default';

export interface ResolvedDatabase {
  url: string;
  redacted: string;
  source: ConfigSource;
  /** True when the value came from the environment and the UI cannot change it. */
  locked: boolean;
}

/**
 * Work out which store to open.
 *
 * Environment wins over the saved config so a container can override whatever a
 * user saved from the settings page, and the legacy `OPENCONTEXT_STORE_PATH`
 * keeps working by mapping onto the JSON adapter — an existing install with no
 * configuration resolves to exactly the file it has always used.
 */
export function resolveDatabase(): ResolvedDatabase {
  const fromEnv = process.env.OPENCONTEXT_DB_URL?.trim();
  if (fromEnv) {
    return { url: fromEnv, redacted: redactDsn(fromEnv), source: 'env', locked: true };
  }

  const fromConfig = readConfig().database?.url?.trim();
  if (fromConfig) {
    return {
      url: fromConfig,
      redacted: redactDsn(fromConfig),
      source: 'config-file',
      locked: false,
    };
  }

  const legacyPath = process.env.OPENCONTEXT_STORE_PATH?.trim();
  if (legacyPath) {
    const url = `json://${legacyPath}`;
    return { url, redacted: url, source: 'legacy-store-path', locked: true };
  }

  const url = `json://${getDefaultJsonPath()}`;
  return { url, redacted: url, source: 'default', locked: false };
}

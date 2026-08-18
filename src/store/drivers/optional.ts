import { DriverNotInstalledError, type DbScheme } from '../types.js';

/**
 * Import a driver that may not be installed.
 *
 * The specifier is held in a variable rather than written as a literal so that
 * TypeScript does not try to resolve the module at build time. These are
 * optional peer dependencies — the package builds and runs fine with none of
 * them present, and a user installs only the one backend they actually use.
 *
 * A failed import is reported as an actionable install instruction rather than a
 * module-resolution stack trace.
 */
export async function importOptional<T = Record<string, unknown>>(
  specifier: string,
  scheme: DbScheme,
  packageName: string = specifier,
): Promise<T> {
  let loaded: unknown;
  try {
    loaded = await import(/* @vite-ignore */ specifier);
  } catch (error) {
    throw new DriverNotInstalledError(scheme, packageName, error);
  }

  // Several of these drivers are CommonJS, so the useful export sits on
  // `.default` once Node's interop has wrapped it.
  const namespace = loaded as { default?: unknown };
  if (namespace.default && typeof namespace.default === 'object') {
    return { ...(namespace.default as object), ...(loaded as object) } as T;
  }
  return loaded as T;
}

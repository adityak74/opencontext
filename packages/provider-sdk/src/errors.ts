export class DriverNotInstalledError extends Error {
  constructor(public readonly scheme: string, public readonly packageName: string, public readonly reason?: unknown) {
    super(`${scheme} driver is not installed.\nInstall it with:  npm install ${packageName}`);
    this.name = 'DriverNotInstalledError';
  }
}

export class InvalidDsnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDsnError';
  }
}

export class ConcurrencyConflictError extends Error {
  constructor(public readonly contextId: string, public readonly expectedRevision: number, public readonly actualRevision: number) {
    super(`Concurrency conflict on context '${contextId}': expected revision ${expectedRevision}, but found ${actualRevision}`);
    this.name = 'ConcurrencyConflictError';
  }
}

export class UnsupportedSchemeError extends Error {
  constructor(public readonly scheme: string) {
    super(`Unsupported storage scheme: '${scheme}'`);
    this.name = 'UnsupportedSchemeError';
  }
}


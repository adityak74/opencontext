import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Database,
  Check,
  X,
  Loader2,
  Cloud,
  HardDrive,
  Lock,
  ArrowRightLeft,
  AlertTriangle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types mirroring the /api/db responses
// ---------------------------------------------------------------------------

interface AdapterInfo {
  scheme: string;
  label: string;
  target: string;
  remote: boolean;
}

interface AdapterOption {
  scheme: string;
  label: string;
  example: string;
  packageName: string | null;
  remote: boolean;
  family: 'file' | 'sql' | 'document';
  installed: boolean;
}

interface DbStatus {
  connected: boolean;
  adapter: AdapterInfo | null;
  source: 'env' | 'config-file' | 'legacy-store-path' | 'default';
  locked: boolean;
  url: string;
  counts: { contexts: number; bubbles: number } | null;
  error?: string;
}

const SOURCE_LABELS: Record<DbStatus['source'], string> = {
  env: 'OPENCONTEXT_DB_URL environment variable',
  'config-file': 'saved settings',
  'legacy-store-path': 'OPENCONTEXT_STORE_PATH environment variable',
  default: 'default (no configuration)',
};

const FAMILY_LABELS: Record<AdapterOption['family'], string> = {
  file: 'Local file',
  sql: 'SQL',
  document: 'Document & key-value',
};

/** Backends we ship a vendor mark for, served from `public/db-logos`. */
const LOGO_SCHEMES = new Set([
  'json',
  'sqlite',
  'd1',
  'duckdb',
  'libsql',
  'postgres',
  'cloudsql',
  'mysql',
  'mssql',
  'mongodb',
  'redis',
  'firestore',
  'dynamodb',
  'surrealdb',
]);

/**
 * A backend's vendor mark, on a light chip.
 *
 * The marks keep their own brand colours, and several of those — SQLite's navy,
 * JSON's grey — vanish against this theme's black. Giving every logo the same
 * light square to sit on keeps them all legible and reads as one set. Backends
 * with no vendor behind them (in-memory) render nothing.
 */
function AdapterLogo({ scheme, size = 18 }: { scheme: string; size?: number }) {
  if (!LOGO_SCHEMES.has(scheme)) {
    return null;
  }
  const inner = Math.round(size * 0.72);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[4px] bg-white/95"
      style={{ width: size, height: size }}
    >
      <img src={`/db-logos/${scheme}.svg`} alt="" aria-hidden="true" width={inner} height={inner} />
    </span>
  );
}

type Feedback = { kind: 'ok' | 'error'; message: string } | null;

export default function DatabaseSettings() {
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [adapters, setAdapters] = useState<AdapterOption[]>([]);
  const [url, setUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [testResult, setTestResult] = useState<Feedback>(null);
  const [saveResult, setSaveResult] = useState<Feedback>(null);
  const [migrateResult, setMigrateResult] = useState<Feedback>(null);

  const loadStatus = useCallback(async () => {
    const response = await fetch('/api/db/status');
    setStatus((await response.json()) as DbStatus);
  }, []);

  useEffect(() => {
    void loadStatus();
    void fetch('/api/db/adapters')
      .then((r) => r.json())
      .then((data) => setAdapters(data as AdapterOption[]));
  }, [loadStatus]);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/db/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      setTestResult(
        data.ok
          ? { kind: 'ok', message: `Connected to ${data.adapter.label}` }
          : { kind: 'error', message: data.error },
      );
    } catch (error) {
      setTestResult({ kind: 'error', message: (error as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const response = await fetch('/api/db/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (data.ok) {
        setSaveResult({ kind: 'ok', message: `Now using ${data.adapter.label}` });
        setUrl('');
        await loadStatus();
      } else {
        setSaveResult({ kind: 'error', message: data.error });
      }
    } catch (error) {
      setSaveResult({ kind: 'error', message: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleMigrate() {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const response = await fetch('/api/db/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, mode: 'copy' }),
      });
      const data = await response.json();
      setMigrateResult(
        data.ok
          ? {
              kind: 'ok',
              message: `Copied ${data.contexts} contexts and ${data.bubbles} bubbles. Your current store was not changed.`,
            }
          : { kind: 'error', message: data.error },
      );
    } catch (error) {
      setMigrateResult({ kind: 'error', message: (error as Error).message });
    } finally {
      setMigrating(false);
    }
  }

  const selected = adapters.find((adapter) => url.startsWith(`${adapter.scheme}:`));
  const missingDriver = selected && !selected.installed ? selected : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Database</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Store your contexts wherever you like — a local file, an embedded database, or your
          own server. Everything stays on infrastructure you control.
        </p>
      </div>

      {/* ---------------- current backend ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Current store</span>
            {status?.connected ? (
              <Badge variant="secondary" className="ml-auto gap-1">
                <Check size={11} /> Connected
              </Badge>
            ) : status ? (
              <Badge variant="destructive" className="ml-auto gap-1">
                <X size={11} /> Not connected
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!status ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {status.adapter && <AdapterLogo scheme={status.adapter.scheme} />}
                {status.adapter?.remote ? (
                  <Cloud size={14} className="text-muted-foreground" />
                ) : (
                  <HardDrive size={14} className="text-muted-foreground" />
                )}
                <span className="text-sm text-foreground">
                  {status.adapter?.label ?? 'Unknown'}
                </span>
              </div>

              <div className="text-xs font-mono text-muted-foreground break-all">
                {status.url}
              </div>

              <div className="text-xs text-muted-foreground">
                Configured by {SOURCE_LABELS[status.source]}
              </div>

              {status.counts && (
                <div className="text-xs text-muted-foreground">
                  {status.counts.contexts} contexts · {status.counts.bubbles} bubbles
                </div>
              )}

              {status.error && (
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span className="break-all">{status.error}</span>
                </div>
              )}

              {status.locked && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground border-t border-border pt-3">
                  <Lock size={13} className="mt-0.5 shrink-0" />
                  <span>
                    An environment variable is setting the database, so it takes precedence over
                    anything saved here. Unset it to change the store from this page.
                  </span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------- pick a backend ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <span className="text-sm font-medium text-foreground">Connect a different database</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {(['file', 'sql', 'document'] as const).map((family) => (
              <div key={family} className="space-y-1.5">
                <div className="text-xs text-muted-foreground">{FAMILY_LABELS[family]}</div>
                <div className="flex flex-wrap gap-1.5">
                  {adapters
                    .filter((adapter) => adapter.family === family)
                    .map((adapter) => (
                      <button
                        key={adapter.scheme}
                        type="button"
                        onClick={() => setUrl(adapter.example)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors ${
                          selected?.scheme === adapter.scheme
                            ? 'border-foreground/40 bg-accent text-foreground'
                            : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                        }`}
                      >
                        <AdapterLogo scheme={adapter.scheme} size={14} />
                        {adapter.label}
                        {!adapter.installed && (
                          <span className="ml-1.5 opacity-50">·</span>
                        )}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="db-url" className="text-xs">
              Connection string
            </Label>
            <Input
              id="db-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="postgres://user:password@host:5432/opencontext"
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Saved to <span className="font-mono">~/.opencontext/config.json</span> with
              owner-only permissions. It never leaves this machine.
            </p>
          </div>

          {missingDriver && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground border border-border rounded-md p-2.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                {missingDriver.label} needs a driver that is not installed yet. Run{' '}
                <span className="font-mono text-foreground">
                  npm install {missingDriver.packageName}
                </span>
                .
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleTest} disabled={!url || testing}>
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Test connection
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!url || saving || status?.locked}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
              Save &amp; switch
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMigrate}
              disabled={!url || migrating}
            >
              {migrating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowRightLeft size={14} />
              )}
              Copy my data here
            </Button>
          </div>

          {[testResult, saveResult, migrateResult].map(
            (result, index) =>
              result && (
                <div
                  key={index}
                  className={`flex items-start gap-2 text-xs ${
                    result.kind === 'ok' ? 'text-foreground' : 'text-destructive'
                  }`}
                >
                  {result.kind === 'ok' ? (
                    <Check size={13} className="mt-0.5 shrink-0" />
                  ) : (
                    <X size={13} className="mt-0.5 shrink-0" />
                  )}
                  <span className="break-all">{result.message}</span>
                </div>
              ),
          )}
        </CardContent>
      </Card>
    </div>
  );
}

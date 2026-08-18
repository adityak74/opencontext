import express, { type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Ollama } from 'ollama';
import { ZipExtractor } from './extractor.js';
import { ChatGPTParser } from './parsers/chatgpt.js';
import { ConversationNormalizer } from './parsers/normalizer.js';
import { OllamaPreferenceAnalyzer } from './analyzers/ollama-preferences.js';
import { createStoreManager } from './store/manager.js';
import { migrateStore } from './store/migrate.js';
import { createStore, ADAPTERS, isDriverInstalled } from './store/index.js';
import { parseDsn, redactDsn } from './store/dsn.js';
import { resolveDatabase, clearDatabaseUrl, getDefaultJsonPath } from './store/config.js';
import { InvalidDsnError, DriverNotInstalledError } from './store/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Multer: save uploads to a temp dir on disk (ZipExtractor needs a file path)
const uploadDir = path.join(os.tmpdir(), 'opencontext-uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// Ollama host — defaults to host.docker.internal so containers reach the host machine
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://host.docker.internal:11434';

// Context store — a pluggable backend resolved from env, saved config, or the
// legacy store path. Connects lazily so importing this module stays synchronous.
const storeManager = createStoreManager();
const store = () => storeManager.get();

// Preferences remain files on disk regardless of which database backs the
// contexts, because Claude reads them straight from the filesystem.
const prefsDir = path.dirname(
  process.env.OPENCONTEXT_STORE_PATH ?? getDefaultJsonPath(),
);
const prefsJsonPath = path.join(prefsDir, 'preferences.json');
const prefsMdPath = path.join(prefsDir, 'preferences.md');
const memoryMdPath = path.join(prefsDir, 'memory.md');

function buildPreferencesMd(p: Record<string, unknown>): string {
  const cs = (p.communicationStyle ?? {}) as Record<string, unknown>;
  const bp = (p.behaviorPreferences ?? {}) as Record<string, unknown>;
  const toneMap: Record<string, string> = {
    formal: 'formal and professional', casual: 'casual and conversational',
    neutral: 'clear and neutral', friendly: 'warm and approachable',
    professional: 'precise and business-like',
  };
  const detailMap: Record<string, string> = {
    concise: 'concise responses that get to the point quickly',
    balanced: 'balanced responses with enough detail to be thorough but not verbose',
    thorough: 'detailed, comprehensive explanations that cover edge cases',
  };
  const lines: string[] = [];
  if (cs.tone) {
    lines.push(
      `I prefer ${toneMap[cs.tone as string] ?? cs.tone} communication with ${detailMap[cs.detailLevel as string] ?? cs.detailLevel}.`
    );
  }
  if (cs.useCodeExamples) lines.push('When explaining technical concepts, please provide code examples where relevant.');
  if (cs.preferStepByStep) lines.push('I prefer step-by-step instructions for complex tasks.');
  if (cs.responseFormat === 'markdown') lines.push('Please use markdown formatting in responses.');
  else if (cs.responseFormat === 'plain') lines.push('Please keep responses in plain text without heavy formatting.');
  if (bp.proactiveness === 'proactive') lines.push('Feel free to proactively suggest improvements or point out potential issues.');
  else if (bp.proactiveness === 'minimal') lines.push('Please focus on answering exactly what I ask without adding unsolicited suggestions.');
  if (bp.warnAboutRisks) lines.push('Please warn me about potential risks or pitfalls in my approach.');
  if (bp.suggestAlternatives) lines.push('When relevant, suggest alternative approaches I might consider.');
  const custom = ((p.customInstructions as string) ?? '').trim();
  if (custom) { lines.push(''); lines.push(custom); }
  return lines.join('\n');
}

function buildMemoryMd(p: Record<string, unknown>): string {
  const wc = (p.workContext ?? {}) as Record<string, unknown>;
  const pc = (p.personalContext ?? {}) as Record<string, unknown>;
  const cf = (p.currentFocus ?? {}) as Record<string, unknown>;
  const tp = (p.technicalProfile ?? {}) as Record<string, unknown>;
  const sections: string[] = [];

  sections.push('Work context:');
  const workParts: string[] = [];
  if (wc.role) workParts.push(`User works as a ${wc.role}`);
  if (wc.industry) workParts.push(` in the ${wc.industry} industry`);
  if (wc.description) workParts.push(`. ${wc.description}`);
  const langs = tp.primaryLanguages as string[] | undefined;
  if (langs?.length) workParts.push(`. Primary languages: ${langs.join(', ')}`);
  const fw = tp.frameworks as string[] | undefined;
  if (fw?.length) workParts.push(`. Frameworks: ${fw.join(', ')}`);
  sections.push(workParts.join('') || 'No work context provided.');

  sections.push('');
  sections.push('Personal context:');
  const personalParts: string[] = [];
  if (pc.background) personalParts.push(pc.background as string);
  const interests = pc.interests as string[] | undefined;
  if (interests?.length) personalParts.push(`Interests include: ${interests.join(', ')}.`);
  if (tp.experienceLevel) personalParts.push(`Technical experience level: ${tp.experienceLevel}.`);
  sections.push(personalParts.join(' ') || 'No personal context provided.');

  sections.push('');
  sections.push('Top of mind:');
  const focusParts: string[] = [];
  const projects = cf.projects as string[] | undefined;
  if (projects?.length) focusParts.push(`Active projects: ${projects.join(', ')}.`);
  const goals = cf.goals as string[] | undefined;
  if (goals?.length) focusParts.push(`Goals: ${goals.join(', ')}.`);
  if (cf.topOfMind) focusParts.push(cf.topOfMind as string);
  sections.push(focusParts.join(' ') || 'No current focus provided.');

  return sections.join('\n');
}

// Serve built UI static files
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ollamaHost: OLLAMA_HOST, store: resolveDatabase().redacted });
});

// ---------------------------------------------------------------------------
// Ollama — list available models on the host
// ---------------------------------------------------------------------------

app.get('/api/ollama/models', async (_req: Request, res: Response) => {
  try {
    const ollama = new Ollama({ host: OLLAMA_HOST });
    const { models } = await ollama.list();
    res.json(
      models.map((m) => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
      })),
    );
  } catch {
    res.status(503).json({ error: `Ollama unreachable at ${OLLAMA_HOST}` });
  }
});

// ---------------------------------------------------------------------------
// Convert — upload a ChatGPT ZIP and run the full pipeline
// ---------------------------------------------------------------------------

app.post('/api/convert', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const ollamaHost = (req.body.ollamaHost as string | undefined) ?? OLLAMA_HOST;
  const model = (req.body.model as string | undefined) ?? process.env.OLLAMA_MODEL ?? 'gpt-oss:20b';
  const skipPreferences = req.body.skipPreferences === 'true';

  const extractor = new ZipExtractor();
  let tempDir: string | undefined;

  try {
    const extracted = await extractor.extractZip(req.file.path);
    tempDir = extracted.tempDir;

    const parser = new ChatGPTParser();
    const chatGPTConvs = parser.parseConversations(extracted.conversationsPath);

    const normalizer = new ConversationNormalizer();
    const normalized = chatGPTConvs
      .map((c) => normalizer.normalize(c))
      .filter((c) => normalizer.isValidConversation(c));

    let preferences = '';
    let memory = '';

    const analyzer = new OllamaPreferenceAnalyzer(model, ollamaHost);
    if (!skipPreferences) {
      try {
        preferences = await analyzer.analyzePreferences(normalized);
        memory = await analyzer.analyzeMemory(normalized);
      } catch {
        preferences = analyzer.generateBasicPreferences(normalized);
        memory = analyzer.generateBasicMemory(normalized);
      }
    } else {
      preferences = analyzer.generateBasicPreferences(normalized);
      memory = analyzer.generateBasicMemory(normalized);
    }

    res.json({
      conversations: normalized.map((c) => ({
        id: c.id,
        title: c.title,
        created: c.created,
        updated: c.updated,
        messageCount: c.messages.length,
      })),
      preferences,
      memory,
      stats: {
        total: chatGPTConvs.length,
        processed: normalized.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Conversion failed' });
  } finally {
    fs.rmSync(req.file.path, { force: true });
    if (tempDir) extractor.cleanup(tempDir);
  }
});

// ---------------------------------------------------------------------------
// Preferences — stored as preferences.json + preferences.md + memory.md
// ---------------------------------------------------------------------------

app.get('/api/preferences', (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(prefsJsonPath)) {
      res.json(JSON.parse(fs.readFileSync(prefsJsonPath, 'utf-8')));
    } else {
      res.json(null);
    }
  } catch {
    res.status(500).json({ error: 'Failed to read preferences' });
  }
});

app.put('/api/preferences', (req: Request, res: Response) => {
  try {
    const prefs = req.body as Record<string, unknown>;
    fs.mkdirSync(prefsDir, { recursive: true });
    fs.writeFileSync(prefsJsonPath, JSON.stringify(prefs, null, 2) + '\n');
    fs.writeFileSync(prefsMdPath, buildPreferencesMd(prefs) + '\n');
    fs.writeFileSync(memoryMdPath, buildMemoryMd(prefs) + '\n');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// ---------------------------------------------------------------------------
// Contexts — CRUD for the MCP context store
// ---------------------------------------------------------------------------

app.get('/api/contexts', async (req: Request, res: Response) => {
  const tag = req.query.tag as string | undefined;
  res.json(await (await store()).listContexts(tag));
});

app.post('/api/contexts', async (req: Request, res: Response) => {
  const { content, tags, source, bubbleId } = req.body as {
    content: string;
    tags?: string[];
    source?: string;
    bubbleId?: string;
  };
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  res.status(201).json(await (await store()).saveContext(content, tags, source, bubbleId));
});

app.get('/api/contexts/search', async (req: Request, res: Response) => {
  const q = req.query.q as string;
  if (!q) {
    res.status(400).json({ error: 'q query param required' });
    return;
  }
  res.json(await (await store()).searchContexts(q));
});

app.get('/api/contexts/:id', async (req: Request, res: Response) => {
  const entry = await (await store()).getContext(req.params['id'] as string);
  if (!entry) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(entry);
});

app.put('/api/contexts/:id', async (req: Request, res: Response) => {
  const { content, tags, bubbleId } = req.body as {
    content: string;
    tags?: string[];
    bubbleId?: string | null;
  };
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  const updated = await (await store()).updateContext(req.params['id'] as string, content, tags, bubbleId);
  if (!updated) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(updated);
});

app.delete('/api/contexts/:id', async (req: Request, res: Response) => {
  const deleted = await (await store()).deleteContext(req.params['id'] as string);
  if (!deleted) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Bubbles — CRUD for project workspaces
// ---------------------------------------------------------------------------

app.get('/api/bubbles', async (_req: Request, res: Response) => {
  const db = await store();
  const bubbles = await db.listBubbles();
  const withCounts = await Promise.all(
    bubbles.map(async (b) => ({
      ...b,
      contextCount: (await db.listContextsByBubble(b.id)).length,
    })),
  );
  res.json(withCounts);
});

app.post('/api/bubbles', async (req: Request, res: Response) => {
  const { name, description } = req.body as { name: string; description?: string };
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  res.status(201).json(await (await store()).createBubble(name, description));
});

app.get('/api/bubbles/:id', async (req: Request, res: Response) => {
  const bubble = await (await store()).getBubble(req.params['id'] as string);
  if (!bubble) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({
    ...bubble,
    contextCount: (await (await store()).listContextsByBubble(bubble.id)).length,
  });
});

app.get('/api/bubbles/:id/contexts', async (req: Request, res: Response) => {
  const bubble = await (await store()).getBubble(req.params['id'] as string);
  if (!bubble) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(await (await store()).listContextsByBubble(req.params['id'] as string));
});

app.put('/api/bubbles/:id', async (req: Request, res: Response) => {
  const { name, description } = req.body as { name: string; description?: string };
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const updated = await (await store()).updateBubble(req.params['id'] as string, name, description);
  if (!updated) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(updated);
});

app.delete('/api/bubbles/:id', async (req: Request, res: Response) => {
  const deleteContexts = req.query['deleteContexts'] === 'true';
  const deleted = await (await store()).deleteBubble(req.params['id'] as string, deleteContexts);
  if (!deleted) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).send();
});


// ---------------------------------------------------------------------------
// Database — inspect, test, switch and migrate the backing store (BYODB)
// ---------------------------------------------------------------------------

/** Turn a store failure into a useful message without leaking credentials. */
function describeStoreError(error: unknown): { status: number; message: string } {
  if (error instanceof InvalidDsnError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof DriverNotInstalledError) {
    return { status: 400, message: error.message };
  }
  const raw = error instanceof Error ? error.message : String(error);
  // The driver's own message is the only useful diagnostic for a refused
  // connection, but it can echo the connection string back — so redact it.
  return { status: 502, message: redactDsn(raw) };
}

app.get('/api/db/status', async (_req: Request, res: Response) => {
  const resolution = resolveDatabase();
  try {
    const db = await store();
    const [contexts, bubbles] = await Promise.all([db.listContexts(), db.listBubbles()]);
    res.json({
      connected: true,
      adapter: db.info,
      source: resolution.source,
      locked: resolution.locked,
      url: resolution.redacted,
      counts: { contexts: contexts.length, bubbles: bubbles.length },
    });
  } catch (error) {
    const { message } = describeStoreError(error);
    res.json({
      connected: false,
      adapter: null,
      source: resolution.source,
      locked: resolution.locked,
      url: resolution.redacted,
      counts: null,
      error: message,
    });
  }
});

app.get('/api/db/adapters', async (_req: Request, res: Response) => {
  const adapters = await Promise.all(
    ADAPTERS.map(async (adapter) => ({
      ...adapter,
      installed: await isDriverInstalled(adapter.scheme),
    })),
  );
  res.json(adapters);
});

app.post('/api/db/test', async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ ok: false, error: 'url is required' });
    return;
  }
  let candidate;
  try {
    // Open, ping, and close again — a test must never leave a connection behind
    // or disturb the store currently in use.
    candidate = await createStore(url);
    await candidate.ping();
    res.json({ ok: true, adapter: candidate.info });
  } catch (error) {
    const { status, message } = describeStoreError(error);
    res.status(status).json({ ok: false, error: message });
  } finally {
    await candidate?.close().catch(() => undefined);
  }
});

app.put('/api/db/config', async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  if (resolveDatabase().locked) {
    res.status(409).json({
      error:
        'The database is set by the OPENCONTEXT_DB_URL environment variable, ' +
        'which takes precedence over saved settings. Unset it to change the store here.',
    });
    return;
  }
  try {
    parseDsn(url);
    // reconnect keeps the previous store if the new one fails to open, so a bad
    // connection string cannot take the running server down.
    const info = await storeManager.reconnect(url, { persist: true });
    res.json({ ok: true, adapter: info });
  } catch (error) {
    const { status, message } = describeStoreError(error);
    res.status(status).json({ ok: false, error: message });
  }
});

app.delete('/api/db/config', async (_req: Request, res: Response) => {
  if (resolveDatabase().locked) {
    res.status(409).json({ error: 'The database is pinned by an environment variable.' });
    return;
  }
  clearDatabaseUrl();
  try {
    const info = await storeManager.reconnect(resolveDatabase().url);
    res.json({ ok: true, adapter: info });
  } catch (error) {
    const { status, message } = describeStoreError(error);
    res.status(status).json({ ok: false, error: message });
  }
});

app.post('/api/db/migrate', async (req: Request, res: Response) => {
  const { url, mode } = req.body as { url?: string; mode?: 'copy' | 'replace' };
  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  let target;
  try {
    target = await createStore(url);
    // The source is only read, so a failure here cannot damage existing data.
    const result = await migrateStore(await store(), target, { mode: mode ?? 'copy' });
    res.json({ ok: true, ...result, target: target.info });
  } catch (error) {
    const { status, message } = describeStoreError(error);
    res.status(status).json({ ok: false, error: message });
  } finally {
    await target?.close().catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// SPA fallback — all non-API routes serve the React app
// ---------------------------------------------------------------------------

app.get('/{*splat}', (_req: Request, res: Response) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'UI not found — run the build first' });
  }
});

// Export app for testing (supertest imports it without starting the server)
export { app };

// ---------------------------------------------------------------------------
// Start — skipped when imported by tests (NODE_ENV=test set by Vitest)
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV !== 'test') {
  const PORT = parseInt(process.env.PORT ?? '3000', 10);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`opencontext server  →  http://0.0.0.0:${PORT}`);
    console.log(`Ollama host         →  ${OLLAMA_HOST}`);
    console.log(`Context store       →  ${resolveDatabase().redacted}`);
    console.log(`UI                  →  ${fs.existsSync(publicDir) ? 'served from /public' : 'not built'}`);
  });
}

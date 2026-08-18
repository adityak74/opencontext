import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Module mocks
// vi.hoisted creates values before any module evaluation.
// Constructor mocks MUST use regular `function` (not arrow functions) so
// Vitest v4 / path-to-regexp can use them with `new`.
// ---------------------------------------------------------------------------

const mockStore = vi.hoisted(() => ({
  info: { scheme: 'json', label: 'JSON file', target: '/tmp/test/contexts.json', remote: false },
  connect: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  ping: vi.fn(async () => {}),
  listContexts: vi.fn(),
  saveContext: vi.fn(),
  searchContexts: vi.fn(),
  getContext: vi.fn(),
  updateContext: vi.fn(),
  deleteContext: vi.fn(),
  listContextsByBubble: vi.fn(),
  listBubbles: vi.fn(),
  getBubble: vi.fn(),
  createBubble: vi.fn(),
  updateBubble: vi.fn(),
  deleteBubble: vi.fn(),
}));

// The store is now an async, pluggable adapter reached through a manager, so the
// mock resolves a promise and stands in for whichever backend is configured.
vi.mock('../src/store/manager.js', () => ({
  createStoreManager: vi.fn(function () {
    return {
      get: vi.fn(async () => mockStore),
      resolution: vi.fn(() => ({
        url: 'json:///tmp/test/contexts.json',
        redacted: 'json:///tmp/test/contexts.json',
        source: 'default',
        locked: false,
      })),
      reconnect: vi.fn(async () => mockStore.info),
      close: vi.fn(async () => {}),
    };
  }),
}));

const mockOllamaInstance = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('ollama', () => ({
  Ollama: vi.fn(function () { return mockOllamaInstance; }),
}));

const mockExtractorInstance = vi.hoisted(() => ({
  extractZip: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock('../src/extractor.js', () => ({
  ZipExtractor: vi.fn(function () { return mockExtractorInstance; }),
}));

const mockParserInstance = vi.hoisted(() => ({ parseConversations: vi.fn() }));
vi.mock('../src/parsers/chatgpt.js', () => ({
  ChatGPTParser: vi.fn(function () { return mockParserInstance; }),
}));

const mockNormalizerInstance = vi.hoisted(() => ({
  normalize: vi.fn(),
  isValidConversation: vi.fn(),
}));
vi.mock('../src/parsers/normalizer.js', () => ({
  ConversationNormalizer: vi.fn(function () { return mockNormalizerInstance; }),
}));

const mockAnalyzerInstance = vi.hoisted(() => ({
  analyzePreferences: vi.fn(),
  analyzeMemory: vi.fn(),
  generateBasicPreferences: vi.fn(),
  generateBasicMemory: vi.fn(),
}));
vi.mock('../src/analyzers/ollama-preferences.js', () => ({
  OllamaPreferenceAnalyzer: vi.fn(function () { return mockAnalyzerInstance; }),
}));

// Import app AFTER mocks are registered
import { app } from '../src/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeEntry = {
  id: 'abc-123',
  content: 'Remember this',
  tags: ['test'],
  source: 'chat',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  it('returns 200 with ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('ollamaHost');
    expect(res.body).toHaveProperty('store');
  });
});

// ---------------------------------------------------------------------------
// GET /api/ollama/models
// ---------------------------------------------------------------------------

describe('GET /api/ollama/models', () => {
  it('returns model list when Ollama is reachable', async () => {
    mockOllamaInstance.list.mockResolvedValueOnce({
      models: [
        { name: 'llama3:8b', size: 4_000_000_000, modified_at: '2024-01-01' },
        { name: 'gpt-oss:20b', size: 12_000_000_000, modified_at: '2024-02-01' },
      ],
    });

    const res = await request(app).get('/api/ollama/models');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('llama3:8b');
    expect(res.body[1].name).toBe('gpt-oss:20b');
  });

  it('returns 503 when Ollama is unreachable', async () => {
    mockOllamaInstance.list.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app).get('/api/ollama/models');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Ollama unreachable');
  });
});

// ---------------------------------------------------------------------------
// POST /api/convert
// ---------------------------------------------------------------------------

describe('POST /api/convert', () => {
  // Set up default happy-path mocks before each test.
  // Use *Once variants in individual tests to override without leaking state.
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractorInstance.extractZip.mockResolvedValue({
      conversationsPath: '/tmp/test-conversations.json',
      tempDir: '/tmp/test-extract-dir',
    });
    mockParserInstance.parseConversations.mockReturnValue([]);
    mockNormalizerInstance.normalize.mockImplementation((c) => c);
    mockNormalizerInstance.isValidConversation.mockReturnValue(true);
    mockAnalyzerInstance.analyzePreferences.mockResolvedValue('AI preferences');
    mockAnalyzerInstance.analyzeMemory.mockResolvedValue('AI memory');
    mockAnalyzerInstance.generateBasicPreferences.mockReturnValue('Basic preferences');
    mockAnalyzerInstance.generateBasicMemory.mockReturnValue('Basic memory');
    mockExtractorInstance.cleanup.mockReset();
  });

  it('returns 400 when no file is provided', async () => {
    const res = await request(app).post('/api/convert');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No file uploaded');
  });

  it('runs the full pipeline and returns conversations with AI preferences', async () => {
    const res = await request(app)
      .post('/api/convert')
      .attach('file', Buffer.from('PK fake zip'), 'export.zip');

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.preferences).toBe('AI preferences');
    expect(res.body.memory).toBe('AI memory');
    expect(res.body.stats).toEqual({ total: 0, processed: 0 });
    expect(mockExtractorInstance.cleanup).toHaveBeenCalledWith('/tmp/test-extract-dir');
  });

  it('uses basic preferences when skipPreferences=true', async () => {
    const res = await request(app)
      .post('/api/convert')
      .field('skipPreferences', 'true')
      .attach('file', Buffer.from('PK fake zip'), 'export.zip');

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.preferences).toBe('Basic preferences');
    expect(res.body.memory).toBe('Basic memory');
    expect(mockAnalyzerInstance.analyzePreferences).not.toHaveBeenCalled();
  });

  it('falls back to basic preferences when Ollama analysis throws', async () => {
    mockAnalyzerInstance.analyzePreferences.mockRejectedValueOnce(new Error('Ollama down'));

    const res = await request(app)
      .post('/api/convert')
      .attach('file', Buffer.from('PK fake zip'), 'export.zip');

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.preferences).toBe('Basic preferences');
    expect(res.body.memory).toBe('Basic memory');
  });

  it('returns 500 when ZIP extraction fails', async () => {
    mockExtractorInstance.extractZip.mockRejectedValueOnce(new Error('Not a valid ZIP'));

    const res = await request(app)
      .post('/api/convert')
      .attach('file', Buffer.from('not a zip'), 'bad.zip');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Not a valid ZIP');
  });

  it('accepts a custom ollamaHost in the request body', async () => {
    const res = await request(app)
      .post('/api/convert')
      .field('ollamaHost', 'http://custom-host:11434')
      .attach('file', Buffer.from('PK fake zip'), 'export.zip');

    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('returns correct stats when parser returns multiple conversations', async () => {
    const fakeConv = {
      id: '1',
      title: 'Test',
      created: new Date(),
      updated: new Date(),
      messages: [],
    };
    mockParserInstance.parseConversations.mockReturnValueOnce([{}, {}, {}]);
    mockNormalizerInstance.normalize.mockReturnValue(fakeConv);
    mockNormalizerInstance.isValidConversation.mockReturnValue(true);

    const res = await request(app)
      .post('/api/convert')
      .attach('file', Buffer.from('PK fake zip'), 'export.zip');

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.stats.total).toBe(3);
    expect(res.body.stats.processed).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// GET /api/contexts
// ---------------------------------------------------------------------------

describe('GET /api/contexts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all contexts', async () => {
    mockStore.listContexts.mockReturnValueOnce([fakeEntry]);

    const res = await request(app).get('/api/contexts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('abc-123');
    expect(mockStore.listContexts).toHaveBeenCalledWith(undefined);
  });

  it('filters by tag when ?tag= is provided', async () => {
    mockStore.listContexts.mockReturnValueOnce([fakeEntry]);

    const res = await request(app).get('/api/contexts?tag=test');
    expect(res.status).toBe(200);
    expect(mockStore.listContexts).toHaveBeenCalledWith('test');
  });
});

// ---------------------------------------------------------------------------
// POST /api/contexts
// ---------------------------------------------------------------------------

describe('POST /api/contexts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a context and returns 201', async () => {
    mockStore.saveContext.mockReturnValueOnce(fakeEntry);

    const res = await request(app)
      .post('/api/contexts')
      .send({ content: 'Remember this', tags: ['test'], source: 'chat' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('abc-123');
    expect(mockStore.saveContext).toHaveBeenCalledWith('Remember this', ['test'], 'chat', undefined);
  });

  it('returns 400 when content is missing', async () => {
    const res = await request(app)
      .post('/api/contexts')
      .send({ tags: ['test'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('content is required');
    expect(mockStore.saveContext).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/contexts/search
// ---------------------------------------------------------------------------

describe('GET /api/contexts/search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns matching contexts', async () => {
    mockStore.searchContexts.mockReturnValueOnce([fakeEntry]);

    const res = await request(app).get('/api/contexts/search?q=Remember');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mockStore.searchContexts).toHaveBeenCalledWith('Remember');
  });

  it('returns 400 when q param is missing', async () => {
    const res = await request(app).get('/api/contexts/search');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('q query param required');
  });
});

// ---------------------------------------------------------------------------
// GET /api/contexts/:id
// ---------------------------------------------------------------------------

describe('GET /api/contexts/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with entry when found', async () => {
    mockStore.getContext.mockReturnValueOnce(fakeEntry);

    const res = await request(app).get('/api/contexts/abc-123');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('abc-123');
    expect(mockStore.getContext).toHaveBeenCalledWith('abc-123');
  });

  it('returns 404 when not found', async () => {
    mockStore.getContext.mockReturnValueOnce(undefined);

    const res = await request(app).get('/api/contexts/missing-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});

// ---------------------------------------------------------------------------
// PUT /api/contexts/:id
// ---------------------------------------------------------------------------

describe('PUT /api/contexts/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates and returns the context', async () => {
    const updated = { ...fakeEntry, content: 'Updated', updatedAt: '2024-06-01T00:00:00.000Z' };
    mockStore.updateContext.mockReturnValueOnce(updated);

    const res = await request(app)
      .put('/api/contexts/abc-123')
      .send({ content: 'Updated', tags: ['new-tag'] });

    expect(res.status).toBe(200);
    expect(res.body.content).toBe('Updated');
    expect(mockStore.updateContext).toHaveBeenCalledWith('abc-123', 'Updated', ['new-tag'], undefined);
  });

  it('returns 400 when content is missing', async () => {
    const res = await request(app)
      .put('/api/contexts/abc-123')
      .send({ tags: ['tag'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('content is required');
  });

  it('returns 404 when context does not exist', async () => {
    mockStore.updateContext.mockReturnValueOnce(undefined);

    const res = await request(app)
      .put('/api/contexts/missing-id')
      .send({ content: 'Updated' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/contexts/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/contexts/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 204 when deleted', async () => {
    mockStore.deleteContext.mockReturnValueOnce(true);

    const res = await request(app).delete('/api/contexts/abc-123');
    expect(res.status).toBe(204);
    expect(mockStore.deleteContext).toHaveBeenCalledWith('abc-123');
  });

  it('returns 404 when context does not exist', async () => {
    mockStore.deleteContext.mockReturnValueOnce(false);

    const res = await request(app).delete('/api/contexts/missing-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});

// ---------------------------------------------------------------------------
// SPA fallback
// ---------------------------------------------------------------------------

describe('GET /* (SPA fallback)', () => {
  it('returns 404 JSON when public dir is absent (test environment)', async () => {
    const res = await request(app).get('/some-unknown-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('UI not found');
  });
});

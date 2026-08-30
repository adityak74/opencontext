import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, createServer } from '../../src/mcp/server.js';
import { MemoryContextStore } from '@opencontext/provider-sdk';

function createTempStorePath(): string {
  const dir = join(tmpdir(), `opencontext-mcp-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, 'contexts.json');
}

describe('MCP Server', () => {
  let storePath: string;
  let client: Client;

  beforeEach(async () => {
    storePath = createTempStorePath();
    const server = createMcpServer(storePath);
    client = new Client({ name: 'test-client', version: '1.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterEach(() => {
    const dir = storePath.substring(0, storePath.lastIndexOf('/'));
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
  });

  it('should list all available tools', async () => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    expect(toolNames).toContain('save_context');
    expect(toolNames).toContain('recall_context');
    expect(toolNames).toContain('list_contexts');
    expect(toolNames).toContain('delete_context');
    expect(toolNames).toContain('search_contexts');
    expect(toolNames).toContain('update_context');
    expect(toolNames).toContain('create_bubble');
    expect(toolNames).toContain('list_bubbles');
    expect(toolNames).toContain('get_bubble');
    expect(toolNames).toContain('update_bubble');
    expect(toolNames).toContain('delete_bubble');
    expect(toolNames).toContain('save_canonical_context');
    expect(toolNames).toContain('query_canonical_context');
    expect(tools.tools).toHaveLength(13);
  });

  describe('save_context tool', () => {
    it('should save context and return confirmation', async () => {
      const result = await client.callTool({
        name: 'save_context',
        arguments: {
          content: 'I prefer dark mode in all my editors',
          tags: ['preference', 'editor'],
          source: 'chat',
        },
      });

      expect(result.content).toHaveLength(1);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('Saved context with ID:');
      expect(text).toContain('preference, editor');
    });

    it('should save context with defaults when optional params omitted', async () => {
      const result = await client.callTool({
        name: 'save_context',
        arguments: {
          content: 'Remember this fact',
        },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('Saved context with ID:');
      expect(text).toContain('Tags: none');
    });
  });

  describe('recall_context tool', () => {
    it('should recall matching contexts', async () => {
      await client.callTool({
        name: 'save_context',
        arguments: { content: 'I love TypeScript', tags: ['language'] },
      });
      await client.callTool({
        name: 'save_context',
        arguments: { content: 'Python is also good', tags: ['language'] },
      });

      const result = await client.callTool({
        name: 'recall_context',
        arguments: { query: 'TypeScript' },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('Found 1 context(s)');
      expect(text).toContain('I love TypeScript');
    });

    it('should return no-match message when nothing found', async () => {
      const result = await client.callTool({
        name: 'recall_context',
        arguments: { query: 'nonexistent' },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('No contexts found');
    });
  });

  describe('list_contexts tool', () => {
    it('should list all saved contexts', async () => {
      await client.callTool({
        name: 'save_context',
        arguments: { content: 'First item' },
      });
      await client.callTool({
        name: 'save_context',
        arguments: { content: 'Second item' },
      });

      const result = await client.callTool({
        name: 'list_contexts',
        arguments: {},
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('2 context(s)');
    });

    it('should filter by tag', async () => {
      await client.callTool({
        name: 'save_context',
        arguments: { content: 'Work stuff', tags: ['work'] },
      });
      await client.callTool({
        name: 'save_context',
        arguments: { content: 'Personal stuff', tags: ['personal'] },
      });

      const result = await client.callTool({
        name: 'list_contexts',
        arguments: { tag: 'work' },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('1 context(s)');
      expect(text).toContain('Work stuff');
    });

    it('should show empty message when no contexts exist', async () => {
      const result = await client.callTool({
        name: 'list_contexts',
        arguments: {},
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('No contexts saved yet');
    });
  });

  describe('delete_context tool', () => {
    it('should delete an existing context', async () => {
      const saveResult = await client.callTool({
        name: 'save_context',
        arguments: { content: 'Delete me' },
      });

      const saveText = (saveResult.content as Array<{ type: string; text: string }>)[0].text;
      const idMatch = saveText.match(/ID: (\S+)/);
      const id = idMatch![1];

      const deleteResult = await client.callTool({
        name: 'delete_context',
        arguments: { id },
      });

      const text = (deleteResult.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('deleted');
    });

    it('should report when context not found', async () => {
      const result = await client.callTool({
        name: 'delete_context',
        arguments: { id: 'fake-id-123' },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('No context found');
    });
  });

  describe('search_contexts tool', () => {
    it('should search with multiple terms', async () => {
      await client.callTool({
        name: 'save_context',
        arguments: { content: 'TypeScript React frontend project' },
      });
      await client.callTool({
        name: 'save_context',
        arguments: { content: 'TypeScript Node backend service' },
      });

      const result = await client.callTool({
        name: 'search_contexts',
        arguments: { query: 'TypeScript frontend' },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('Found 1 context(s)');
      expect(text).toContain('React frontend');
    });

    it('should return no-match message when nothing found', async () => {
      const result = await client.callTool({
        name: 'search_contexts',
        arguments: { query: 'completely nonexistent term' },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('No contexts found matching');
    });
  });

  describe('update_context tool', () => {
    it('should update an existing context', async () => {
      const saveResult = await client.callTool({
        name: 'save_context',
        arguments: { content: 'Original', tags: ['test'] },
      });

      const saveText = (saveResult.content as Array<{ type: string; text: string }>)[0].text;
      const idMatch = saveText.match(/ID: (\S+)/);
      const id = idMatch![1];

      const updateResult = await client.callTool({
        name: 'update_context',
        arguments: { id, content: 'Updated content', tags: ['updated'] },
      });

      const text = (updateResult.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('updated');
      expect(text).toContain('updated');
    });

    it('should report when context not found', async () => {
      const result = await client.callTool({
        name: 'update_context',
        arguments: { id: 'fake-id', content: 'new content' },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('No context found');
    });
  });
});

describe('MCP Server v2 Tools', () => {
  let server: any;
  let client: Client;
  let rawStore: MemoryContextStore;

  beforeEach(async () => {
    rawStore = new MemoryContextStore();
    await rawStore.connect();
    server = createServer(rawStore as any);
    client = new Client({ name: 'v2-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  it('preserves legacy save_context and recall_context tool execution', async () => {
    const saveRes = await server.handleToolCall('save_context', {
      content: 'Legacy tool test',
      tags: ['test'],
    });
    expect(saveRes.content[0].text).toContain('Saved context with ID:');

    const recallRes = await server.handleToolCall('recall_context', {
      query: 'Legacy tool',
    });
    expect(recallRes.content[0].text).toContain('Legacy tool test');
  });

  it('executes new save_canonical_context tool', async () => {
    const saveRes = await server.handleToolCall('save_canonical_context', {
      content: 'Decision to use OCM 2.0',
      type: 'decision',
      scope: 'project:v2',
    });
    expect(saveRes.content[0].text).toContain('Canonical context saved');

    const queryRes = await server.handleToolCall('query_canonical_context', {
      scope: 'project:v2',
      types: ['decision'],
    });
    expect(queryRes.content[0].text).toContain('Decision to use OCM 2.0');
  });

  it('supports all standard context types in save_canonical_context', async () => {
    const standardTypes = [
      'message',
      'fact',
      'decision',
      'constraint',
      'preference',
      'instruction',
      'artifact',
      'observation',
      'tool_result',
      'summary',
      'checkpoint',
      'insight',
      'pattern',
    ] as const;

    for (const type of standardTypes) {
      const res = await client.callTool({
        name: 'save_canonical_context',
        arguments: {
          content: `Content for ${type}`,
          type,
          scope: 'project:types',
        },
      });
      const text = (res.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain(`Type: ${type}`);
    }
  });

  it('throws a clean error when v2 canonical tools are called with a legacy adapter', async () => {
    const mockLegacyAdapter = {
      saveContext: async () => ({ id: '1', content: 'legacy', tags: [], source: 'test', createdAt: '', updatedAt: '' }),
      recallContext: async () => [],
      listContexts: async () => [],
      deleteContext: async () => true,
      searchContexts: async () => [],
      updateContext: async () => null,
      createBubble: async () => ({ id: 'b1', name: 'bubble', createdAt: '', updatedAt: '' }),
      listBubbles: async () => [],
      getBubble: async () => null,
      updateBubble: async () => null,
      deleteBubble: async () => true,
      listContextsByBubble: async () => [],
      close: async () => {},
    };

    const legacyServer: any = createMcpServer(mockLegacyAdapter as any);

    // Legacy tool should work
    const legRes = await legacyServer.handleToolCall('save_context', { content: 'legacy works' });
    expect(legRes.content[0].text).toContain('Saved context with ID: 1');

    // Canonical tools should throw a clean error
    await expect(
      legacyServer.handleToolCall('save_canonical_context', {
        content: 'Should fail',
        type: 'decision',
      })
    ).rejects.toThrow(/legacy adapter in use|not supported/i);

    await expect(
      legacyServer.handleToolCall('query_canonical_context', {
        namespace: 'default',
      })
    ).rejects.toThrow(/legacy adapter in use|not supported/i);
  });
});


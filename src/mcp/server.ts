import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createContextStoreFromDsn } from '../store/manager.js';
import { resolveDatabase } from '../store/config.js';
import { ContextStoreV1Shim, createCanonicalContext, type ContextEntry } from '@opencontext/core';
import type { ContextStore } from '@opencontext/provider-sdk';
import type { ContextStoreAdapter } from '../store/types.js';

export type StoreOrDsn = string | ContextStore | ContextStoreAdapter;

/**
 * @param databaseUrlOrStore Optional connection string or store instance.
 * When omitted the store is resolved from OPENCONTEXT_DB_URL, then the saved config,
 * then the legacy OPENCONTEXT_STORE_PATH, then the default JSON file.
 */
export function createMcpServer(databaseUrlOrStore?: StoreOrDsn) {
  let v2Store: ContextStore | undefined;
  let v1Store: ContextStoreV1Shim | ContextStoreAdapter | undefined;

  const getStore = async (): Promise<{ v2?: ContextStore; v1: ContextStoreV1Shim | ContextStoreAdapter }> => {
    if (v2Store && v1Store) {
      return { v2: v2Store, v1: v1Store };
    }

    if (databaseUrlOrStore && typeof databaseUrlOrStore === 'object') {
      if ('capabilities' in databaseUrlOrStore && 'put' in databaseUrlOrStore) {
        v2Store = databaseUrlOrStore as ContextStore;
        v1Store = new ContextStoreV1Shim(v2Store);
        return { v2: v2Store, v1: v1Store };
      }
      v1Store = databaseUrlOrStore as ContextStoreAdapter;
      return { v2: undefined, v1: v1Store };
    }

    const dsn = typeof databaseUrlOrStore === 'string'
      ? (databaseUrlOrStore.includes('://') ? databaseUrlOrStore : `json://${databaseUrlOrStore}`)
      : resolveDatabase().url;

    v2Store = await createContextStoreFromDsn(dsn);
    v1Store = new ContextStoreV1Shim(v2Store);
    return { v2: v2Store, v1: v1Store };
  };

  const server = new McpServer({
    name: 'opencontext',
    version: '2.0.0',
  });

  // ---------------------------------------------------------------------------
  // Legacy v1 Context tools (wrapped via ContextStoreV1Shim)
  // ---------------------------------------------------------------------------

  server.tool(
    'save_context',
    'Save a piece of context, memory, or note. Use this when the user says "remember this", "save this", or "keep this in mind".',
    {
      content: z.string().describe('The content to save'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Tags to categorize this context (e.g. ["preference", "code", "project"])'),
      source: z
        .string()
        .optional()
        .describe('Where this context came from (e.g. "chat", "code-review", "meeting")'),
      bubbleId: z
        .string()
        .optional()
        .describe('ID of the bubble (project) to associate this context with'),
    },
    async (args) => {
      const { v1 } = await getStore();
      const entry = await v1.saveContext(
        args.content,
        args.tags || [],
        args.source || 'chat',
        args.bubbleId,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: `Saved context with ID: ${entry.id}\nTags: ${entry.tags.length > 0 ? entry.tags.join(', ') : 'none'}${entry.bubbleId ? `\nBubble: ${entry.bubbleId}` : ''}\nCreated: ${entry.createdAt}`,
          },
        ],
      };
    },
  );

  server.tool(
    'recall_context',
    'Recall saved contexts by searching content and tags. Use this when the user asks "what did I say about...", "do you remember...", or needs previous context.',
    {
      query: z.string().describe('Search query to find matching contexts'),
    },
    async (args) => {
      const { v1 } = await getStore();
      const results = await v1.recallContext(args.query);
      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No contexts found matching "${args.query}".`,
            },
          ],
        };
      }
      const formatted = results
        .map(
          (entry: ContextEntry) =>
            `[${entry.id}] (${entry.tags.join(', ') || 'no tags'})${entry.bubbleId ? ` [bubble:${entry.bubbleId}]` : ''} - ${entry.createdAt}\n${entry.content}`,
        )
        .join('\n\n---\n\n');
      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${results.length} context(s):\n\n${formatted}`,
          },
        ],
      };
    },
  );

  server.tool(
    'list_contexts',
    'List all saved contexts, optionally filtered by tag.',
    {
      tag: z
        .string()
        .optional()
        .describe('Filter by tag (e.g. "preference", "code")'),
    },
    async (args) => {
      const { v1 } = await getStore();
      const results = await v1.listContexts(args.tag);
      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: args.tag
                ? `No contexts found with tag "${args.tag}".`
                : 'No contexts saved yet.',
            },
          ],
        };
      }
      const formatted = results
        .map(
          (entry: ContextEntry) =>
            `[${entry.id}] (${entry.tags.join(', ') || 'no tags'})${entry.bubbleId ? ` [bubble:${entry.bubbleId}]` : ''} - ${entry.createdAt}\n${entry.content.substring(0, 100)}${entry.content.length > 100 ? '...' : ''}`,
        )
        .join('\n\n');
      return {
        content: [
          {
            type: 'text' as const,
            text: `${results.length} context(s):\n\n${formatted}`,
          },
        ],
      };
    },
  );

  server.tool(
    'delete_context',
    'Delete a saved context by its ID.',
    {
      id: z.string().describe('The ID of the context to delete'),
    },
    async (args) => {
      const { v1 } = await getStore();
      const deleted = await v1.deleteContext(args.id);
      return {
        content: [
          {
            type: 'text' as const,
            text: deleted
              ? `Context ${args.id} deleted.`
              : `No context found with ID "${args.id}".`,
          },
        ],
      };
    },
  );

  server.tool(
    'search_contexts',
    'Search through all saved contexts using multiple keywords. All terms must match.',
    {
      query: z
        .string()
        .describe('Space-separated search terms (all must match)'),
    },
    async (args) => {
      const { v1 } = await getStore();
      const results = await v1.searchContexts(args.query);
      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No contexts found matching "${args.query}".`,
            },
          ],
        };
      }
      const formatted = results
        .map(
          (entry: ContextEntry) =>
            `[${entry.id}] (${entry.tags.join(', ') || 'no tags'})${entry.bubbleId ? ` [bubble:${entry.bubbleId}]` : ''} - ${entry.createdAt}\n${entry.content}`,
        )
        .join('\n\n---\n\n');
      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${results.length} context(s):\n\n${formatted}`,
          },
        ],
      };
    },
  );

  server.tool(
    'update_context',
    'Update an existing saved context by its ID.',
    {
      id: z.string().describe('The ID of the context to update'),
      content: z.string().describe('The new content'),
      tags: z
        .array(z.string())
        .optional()
        .describe('New tags (replaces existing tags if provided)'),
      bubbleId: z
        .string()
        .nullable()
        .optional()
        .describe('Bubble ID to assign (null to unassign from bubble)'),
    },
    async (args) => {
      const { v1 } = await getStore();
      const updated = await v1.updateContext(args.id, args.content, args.tags, args.bubbleId);
      if (!updated) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No context found with ID "${args.id}".`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Context ${updated.id} updated.\nTags: ${updated.tags.length > 0 ? updated.tags.join(', ') : 'none'}${updated.bubbleId ? `\nBubble: ${updated.bubbleId}` : ''}\nUpdated: ${updated.updatedAt}`,
          },
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Legacy v1 Bubble tools
  // ---------------------------------------------------------------------------

  server.tool(
    'create_bubble',
    'Create a new bubble (project workspace) to group related contexts together.',
    {
      name: z.string().describe('The name of the bubble / project'),
      description: z
        .string()
        .optional()
        .describe('Optional description of what this bubble is for'),
    },
    async (args) => {
      const { v1 } = await getStore();
      const bubble = await v1.createBubble(args.name, args.description);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Created bubble "${bubble.name}" with ID: ${bubble.id}${bubble.description ? `\nDescription: ${bubble.description}` : ''}\nCreated: ${bubble.createdAt}`,
          },
        ],
      };
    },
  );

  server.tool(
    'list_bubbles',
    'List all bubbles (project workspaces).',
    {},
    async () => {
      const { v1 } = await getStore();
      const bubbles = await v1.listBubbles();
      if (bubbles.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No bubbles created yet.' }],
        };
      }
      const formatted = (
        await Promise.all(
          bubbles.map(async (b) => {
            const contexts = await v1.listContextsByBubble(b.id);
            return `[${b.id}] ${b.name}${b.description ? ` — ${b.description}` : ''} (${contexts.length} context${contexts.length === 1 ? '' : 's'})`;
          }),
        )
      ).join('\n');
      return {
        content: [{ type: 'text' as const, text: `${bubbles.length} bubble(s):\n\n${formatted}` }],
      };
    },
  );

  server.tool(
    'get_bubble',
    'Get a bubble and all of its contexts.',
    {
      id: z.string().describe('The ID of the bubble'),
    },
    async (args) => {
      const { v1 } = await getStore();
      const bubble = await v1.getBubble(args.id);
      if (!bubble) {
        return {
          content: [{ type: 'text' as const, text: `No bubble found with ID "${args.id}".` }],
        };
      }
      const contexts = await v1.listContextsByBubble(args.id);
      const ctxText =
        contexts.length === 0
          ? 'No contexts in this bubble.'
          : contexts
              .map(
                (e) =>
                  `  [${e.id}] (${e.tags.join(', ') || 'no tags'}) - ${e.updatedAt}\n  ${e.content.substring(0, 150)}${e.content.length > 150 ? '...' : ''}`,
              )
              .join('\n\n');
      return {
        content: [
          {
            type: 'text' as const,
            text: `Bubble: ${bubble.name} [${bubble.id}]${bubble.description ? `\n${bubble.description}` : ''}\nCreated: ${bubble.createdAt} | Updated: ${bubble.updatedAt}\n\nContexts (${contexts.length}):\n${ctxText}`,
          },
        ],
      };
    },
  );

  server.tool(
    'update_bubble',
    'Update the name or description of a bubble.',
    {
      id: z.string().describe('The ID of the bubble to update'),
      name: z.string().describe('New name for the bubble'),
      description: z
        .string()
        .optional()
        .describe('New description (omit to leave unchanged)'),
    },
    async (args) => {
      const { v1 } = await getStore();
      const updated = await v1.updateBubble(args.id, args.name, args.description);
      if (!updated) {
        return {
          content: [{ type: 'text' as const, text: `No bubble found with ID "${args.id}".` }],
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Bubble ${updated.id} updated.\nName: ${updated.name}${updated.description ? `\nDescription: ${updated.description}` : ''}\nUpdated: ${updated.updatedAt}`,
          },
        ],
      };
    },
  );

  server.tool(
    'delete_bubble',
    'Delete a bubble. Contexts inside the bubble are unassigned (not deleted) unless deleteContexts is true.',
    {
      id: z.string().describe('The ID of the bubble to delete'),
      deleteContexts: z
        .boolean()
        .optional()
        .describe('If true, also delete all contexts inside the bubble (default: false)'),
    },
    async (args) => {
      const { v1 } = await getStore();
      const deleted = await v1.deleteBubble(args.id, args.deleteContexts ?? false);
      return {
        content: [
          {
            type: 'text' as const,
            text: deleted
              ? `Bubble ${args.id} deleted.${args.deleteContexts ? ' All its contexts were also deleted.' : ' Its contexts have been unassigned.'}`
              : `No bubble found with ID "${args.id}".`,
          },
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Native v2 Canonical Context Tools
  // ---------------------------------------------------------------------------

  server.tool(
    'save_canonical_context',
    'Save a canonical context node (v2 OCM model) with rich metadata, provenance, relationships, and scope.',
    {
      content: z.union([z.string(), z.record(z.string(), z.any())]).describe('The content to save (text string or structured JSON object)'),
      type: z
        .enum([
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
        ])
        .optional()
        .describe(
          'Type of context (message, fact, decision, constraint, preference, instruction, artifact, observation, tool_result, summary, checkpoint, insight, pattern)',
        ),
      scope: z.string().optional().describe('Scope identifier (e.g. "global", "project:v2", "bubble:123")'),
      namespace: z.string().optional().describe('Namespace identifier (default: "default")'),
      metadata: z.record(z.string(), z.any()).optional().describe('Arbitrary metadata attributes'),
      relationships: z
        .array(
          z.object({
            targetId: z.string().describe('Target context ID'),
            relation: z.string().describe('Relationship type (e.g. child_of, relates_to, supersedes)'),
            metadata: z.record(z.string(), z.any()).optional().describe('Optional relationship metadata'),
          }),
        )
        .optional()
        .describe('Relationship links to other context nodes'),
      actor: z.enum(['user', 'agent', 'system', 'integration']).optional().describe('Actor type (user, agent, system, integration)'),
      agentId: z.string().optional().describe('Agent ID for provenance tracking'),
      sourceUri: z.string().optional().describe('Source URI or reference'),
      expiresAt: z.string().optional().describe('ISO-8601 UTC timestamp for expiration'),
    },
    async (args) => {
      const { v2 } = await getStore();
      if (!v2) {
        throw new Error('Underlying store does not support canonical v2 context operations (legacy adapter in use).');
      }
      const contentObj =
        typeof args.content === 'string'
          ? { text: args.content, mediaType: 'text/plain' }
          : { structured: args.content };

      const canonical = createCanonicalContext({
        content: contentObj,
        type: args.type as any,
        scope: args.scope,
        namespace: args.namespace,
        metadata: args.metadata,
        relationships: args.relationships,
        actor: args.actor,
        agentId: args.agentId,
        sourceUri: args.sourceUri,
        expiresAt: args.expiresAt,
      });

      const saved = await v2.put(canonical);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Canonical context saved with ID: ${saved.id}\nType: ${saved.type}\nScope: ${saved.scope}\nNamespace: ${saved.namespace}\nRevision: ${saved.version.revision}\nCreated: ${saved.timestamps.createdAt}`,
          },
        ],
      };
    },
  );

  server.tool(
    'query_canonical_context',
    'Query canonical context nodes (v2 OCM model) with scope, type, lifecycle, and full-text search filters.',
    {
      namespace: z.string().optional().describe('Namespace identifier (default: "default")'),
      scope: z.union([z.string(), z.array(z.string())]).optional().describe('Scope ID or array of Scope IDs to filter'),
      types: z.array(z.string()).optional().describe('Array of context types to filter (e.g. ["decision", "fact"])'),
      lifecycle: z
        .array(z.enum(['active', 'archived', 'deprecated', 'soft_deleted', 'pinned']))
        .optional()
        .describe('Lifecycle states to filter (default: ["active"])'),
      fullText: z.string().optional().describe('Full-text search query across content'),
      limit: z.number().optional().describe('Maximum number of items to return (default: 100)'),
      cursor: z.string().optional().describe('Cursor for pagination'),
      order: z.enum(['asc', 'desc']).optional().describe('Sort order (default: "asc")'),
      orderBy: z.enum(['createdAt', 'updatedAt', 'revision']).optional().describe('Field to sort by (default: "createdAt")'),
    },
    async (args) => {
      const { v2 } = await getStore();
      if (!v2) {
        throw new Error('Underlying store does not support canonical v2 context operations (legacy adapter in use).');
      }
      const results = await v2.query({
        namespace: args.namespace || 'default',
        scope: args.scope,
        types: args.types as any,
        lifecycle: args.lifecycle,
        fullText: args.fullText,
        pagination: {
          limit: args.limit ?? 100,
          cursor: args.cursor,
          order: args.order ?? 'asc',
          orderBy: args.orderBy ?? 'createdAt',
        },
      });

      if (results.items.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No canonical contexts found matching query.',
            },
          ],
        };
      }

      const formatted = results.items
        .map(
          (ctx) =>
            `[${ctx.id}] [${ctx.type}] [scope:${ctx.scope}] (rev:${ctx.version.revision}) - ${ctx.timestamps.createdAt}\n${ctx.content.text ?? JSON.stringify(ctx.content.structured ?? {})}`,
        )
        .join('\n\n---\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${results.items.length} canonical context(s):\n\n${formatted}`,
          },
        ],
      };
    },
  );

  // Helper for programmatic direct tool execution in tests and integrations
  (server as any).handleToolCall = async (name: string, args: Record<string, unknown> = {}) => {
    const registered = (server as any)._registeredTools[name];
    if (!registered) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return registered.handler(args, {});
  };

  return server;
}

export const createServer = createMcpServer;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createStoreManager } from '../store/manager.js';

/**
 * @param databaseUrl Optional connection string. When omitted the store is
 * resolved from OPENCONTEXT_DB_URL, then the saved config, then the legacy
 * OPENCONTEXT_STORE_PATH, then the default JSON file.
 */
export function createMcpServer(databaseUrl?: string) {
  const manager = createStoreManager();
  // The backend connects on first tool call rather than at construction, so an
  // unreachable database surfaces as a tool error instead of preventing the MCP
  // server from starting at all.
  const store = () =>
    databaseUrl ? manager.reconnect(databaseUrl).then(() => manager.get()) : manager.get();

  const server = new McpServer({
    name: 'opencontext',
    version: '1.0.0',
  });

  // ---------------------------------------------------------------------------
  // Context tools
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
      const entry = await (await store()).saveContext(
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
      const results = await (await store()).recallContext(args.query);
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
          (entry) =>
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
      const results = await (await store()).listContexts(args.tag);
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
          (entry) =>
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
      const deleted = await (await store()).deleteContext(args.id);
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
      const results = await (await store()).searchContexts(args.query);
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
          (entry) =>
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
      const updated = await (await store()).updateContext(args.id, args.content, args.tags, args.bubbleId);
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
  // Bubble tools
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
      const bubble = await (await store()).createBubble(args.name, args.description);
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
      const bubbles = await (await store()).listBubbles();
      if (bubbles.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No bubbles created yet.' }],
        };
      }
      const db = await store();
      const formatted = (
        await Promise.all(
          bubbles.map(async (b) => {
            const contexts = await db.listContextsByBubble(b.id);
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
      const bubble = await (await store()).getBubble(args.id);
      if (!bubble) {
        return {
          content: [{ type: 'text' as const, text: `No bubble found with ID "${args.id}".` }],
        };
      }
      const contexts = await (await store()).listContextsByBubble(args.id);
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
      const updated = await (await store()).updateBubble(args.id, args.name, args.description);
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
      const deleted = await (await store()).deleteBubble(args.id, args.deleteContexts ?? false);
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

  return server;
}

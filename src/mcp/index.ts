#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';

// The store is resolved from the environment and saved config inside the server,
// so nothing needs to be passed in here.
const server = createMcpServer();
const transport = new StdioServerTransport();

server.connect(transport).catch((error) => {
  console.error('Failed to start opencontext MCP server:', error);
  process.exit(1);
});

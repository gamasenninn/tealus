#!/usr/bin/env node
/**
 * Tealus MCP Server
 * Tealus Bot API を MCP ツールとして公開
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { TealusClient } = require('./tealusClient');
const { registerTools } = require('./tools');

const apiUrl = process.env.TEALUS_API_URL || 'http://localhost:3000';
const userId = process.env.TEALUS_USER_ID || process.env.TEALUS_BOT_ID;
const password = process.env.TEALUS_PASSWORD || process.env.TEALUS_BOT_PASS;

if (!userId || !password) {
  console.error('TEALUS_USER_ID and TEALUS_PASSWORD are required');
  process.exit(1);
}

const server = new McpServer({
  name: 'tealus',
  version: '1.0.0',
});

const client = new TealusClient({ apiUrl, userId, password });

registerTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Tealus MCP Server running on stdio');
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

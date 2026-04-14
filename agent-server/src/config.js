/**
 * Agent Server 設定
 */
require('dotenv').config();

module.exports = {
  // Server
  PORT: parseInt(process.env.AGENT_PORT || '4000'),

  // Tealus API
  TEALUS_API_URL: process.env.TEALUS_API_URL || 'http://localhost:3000',
  TEALUS_BOT_ID: process.env.TEALUS_BOT_ID,
  TEALUS_BOT_PASS: process.env.TEALUS_BOT_PASS,

  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AGENT_LIGHT_MODEL: process.env.AGENT_LIGHT_MODEL || 'gpt-5.4-mini',
  AGENT_ROUTER_MODEL: process.env.AGENT_ROUTER_MODEL || 'gpt-5.4-mini',

  // Tavily
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,

  // Workspace
  WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT || './agent-workspaces',

  // Webhook
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',

  // MCP Cache
  MCP_CACHE_TTL: parseInt(process.env.MCP_CACHE_TTL || String(30 * 60 * 1000)),  // 30分
  MCP_SWEEP_INTERVAL: parseInt(process.env.MCP_SWEEP_INTERVAL || String(5 * 60 * 1000)),  // 5分

  // Limits
  DEEP_TIMEOUT: parseInt(process.env.DEEP_TIMEOUT || '300000'),  // 5分
  DEEP_MAX_BUFFER: parseInt(process.env.DEEP_MAX_BUFFER || '10485760'),  // 10MB
  LIGHT_CONTEXT_MESSAGES: parseInt(process.env.LIGHT_CONTEXT_MESSAGES || '20'),
};

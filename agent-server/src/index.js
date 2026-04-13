/**
 * Tealus Agent Server
 * AIエージェントの3層アーキテクチャ（Router + Light + Deep）
 */
const express = require('express');
const config = require('./config');
const logger = require('./lib/logger');
const webhookRoutes = require('./webhook/routes');
const { initializeAgent } = require('./setup/register');
const { disconnectAll } = require('./mcp/manager');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tealus-agent-server',
    timestamp: new Date().toISOString(),
  });
});

// Webhook endpoint
app.use('/webhook', webhookRoutes);

// Start server
app.listen(config.PORT, async () => {
  logger.info(`Agent Server started on port ${config.PORT}`);
  logger.info(`Tealus API: ${config.TEALUS_API_URL}`);
  logger.info(`Light model: ${config.AGENT_LIGHT_MODEL}`);

  // エージェント初期化（Bot APIログイン、ルーム取得、MCP接続）
  await initializeAgent();
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down...');
  await disconnectAll();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app };

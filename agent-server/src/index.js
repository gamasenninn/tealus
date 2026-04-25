/**
 * Tealus Agent Server
 * AIエージェントの3層アーキテクチャ（Router + Light + Deep）
 */
const config = require('./config');
const logger = require('./lib/logger');
const { app } = require('./app');
const { initializeAgent } = require('./setup/register');
const { closeAllRoomMcp } = require('./mcp/roomMcpManager');

// Start server
app.listen(config.PORT, async () => {
  logger.info(`Agent Server started on port ${config.PORT}`);
  logger.info(`Tealus API: ${config.TEALUS_API_URL}`);
  logger.info(`Light model: ${config.AGENT_LIGHT_MODEL}`);
  logger.info(`TTS provider: ${config.TTS_PROVIDER} (AIVIS_API_KEY: ${process.env.AIVIS_API_KEY ? `set, ${process.env.AIVIS_API_KEY.length} chars` : 'unset'}, TTS_PROVIDER env: ${process.env.TTS_PROVIDER || 'unset'})`);

  // エージェント初期化（Bot APIログイン、ルーム取得、MCP接続）
  await initializeAgent();
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down...');
  await closeAllRoomMcp();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

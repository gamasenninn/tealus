/**
 * Tealus Agent Server
 * AIエージェントの3層アーキテクチャ（Router + Light + Deep）
 */
const config = require('./config');
const logger = require('./lib/logger');
const { app } = require('./app');
const { initializeAgent } = require('./setup/register');
const { closeAllRoomMcp } = require('./mcp/roomMcpManager');
const rtcCapability = require('./lib/rtcCapability');

// Start server
app.listen(config.PORT, async () => {
  logger.info(`Agent Server started on port ${config.PORT}`);
  logger.info(`Tealus API: ${config.TEALUS_API_URL}`);
  logger.info(`Light model: ${config.AGENT_LIGHT_MODEL}`);
  // TTS provider のログは config.js の load 時に出力済み（責務分離）

  // rtc-server reachability の動的検出を開始 (TTS provider の dynamic degrade 用)
  rtcCapability.start();

  // エージェント初期化（Bot APIログイン、ルーム取得、MCP接続）
  await initializeAgent();
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down...');
  rtcCapability.stop();
  await closeAllRoomMcp();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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
const server = app.listen(config.PORT, async () => {
  logger.info(`Agent Server started on port ${config.PORT}`);
  logger.info(`Tealus API: ${config.TEALUS_API_URL}`);
  logger.info(`Light model: ${config.AGENT_LIGHT_MODEL}`);
  // TTS provider のログは config.js の load 時に出力済み（責務分離）

  // エージェント初期化（Bot APIログイン、ルーム取得、MCP接続）
  await initializeAgent();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${config.PORT} は既に使用中です。`);
    logger.error('既存のプロセスを停止してから再起動してください:');
    logger.error(`  Linux/Mac:  lsof -ti:${config.PORT} | xargs kill -9`);
    logger.error(`  Windows:    netstat -ano | findstr :${config.PORT}`);
    logger.error('              (PID 確認後 taskkill /F /PID <pid>)');
    process.exit(1);
  }
  logger.error('Agent Server start error:', err);
  process.exit(1);
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down...');
  server.close();
  await closeAllRoomMcp();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

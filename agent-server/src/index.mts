/**
 * Tealus Agent Server
 * AIエージェントの3層アーキテクチャ（Router + Light + Deep）
 */
// config を最初に import する (config.mts が dotenv.config() を実行するため、
// 他 module の評価より先に .env を確定させる — ESM は import が先に全評価される)
import * as config from './config.mts';
import { logger } from './lib/logger.mts';
import { app } from './app.mts';
import { initializeAgent } from './setup/register.mts';
import { closeAllRoomMcp } from './mcp/roomMcpManager.mts';
import { broadcastShutdown } from './webhook/ccSubscribers.mts';
import { logOrganonInjectState } from './lib/organonContext.mts';
import { logVocabInjectState } from './lib/vocabContext.mts';

// Start server
const server = app.listen(config.PORT, async () => {
  logger.info(`Agent Server started on port ${config.PORT}`);
  logger.info(`Tealus API: ${config.TEALUS_API_URL}`);
  logger.info(`Light model: ${config.AGENT_LIGHT_MODEL}`);
  // TTS provider のログは config.mts の load 時に出力済み（責務分離）
  logOrganonInjectState(); // organon inject の ON/OFF を起動時に明示（#304、default OFF）
  logVocabInjectState();   // STT vocab inject の ON/OFF を起動時に明示（default OFF、opt-in）

  // エージェント初期化（Bot APIログイン、ルーム取得、MCP接続）
  await initializeAgent();
});

server.on('error', (err: NodeJS.ErrnoException) => {
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
  // ★ cc-queue の購読者に「計画的な停止」を先に伝える (#365)。
  //   これが無いと、別マシンのクライアントは再起動を「予定外の切断」として
  //   毎回通知する。人が毎回予告する運用は忘れられるので、サーバが自分で言う。
  //   クラッシュ時には当然出ない = 予告できないものは異常として残る。
  //   server.close() より先に呼ぶこと (接続を閉じてからでは届かない)。
  try { broadcastShutdown(config.CC_SHUTDOWN_EXPECT_BACK_MS); } catch { /* 停止処理は止めない */ }
  server.close();
  await closeAllRoomMcp();
  // ★ logger (winston) の file transport は非同期。process.exit を即座に呼ぶと
  //   直前のログが書き出される前に落ちる。実際 2026-08-02 に、__bye は正しく
  //   送信されているのに「停止を予告しました」の行だけがログから消えていた
  //   (受信側の curl では観測できた)。**動いているのに見えない**状態になるので待つ。
  await new Promise((r) => setTimeout(r, 200));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

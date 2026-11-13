/**
 * Tealus Agent Server
 * AIエージェントの3層アーキテクチャ（Router + Light + Deep）
 */
// config を最初に import する (config.mts が dotenv.config() を実行するため、
// 他 module の評価より先に .env を確定させる — ESM は import が先に全評価される)
import * as config from './config.mts';
import { logger } from './lib/logger.mts';
import { app } from './app.mts';
import { initializeAgentWithRetry } from './setup/register.mts';
import { closeAllRoomMcp } from './mcp/roomMcpManager.mts';
import { broadcastShutdown } from './webhook/ccSubscribers.mts';
import { pendingRooms, setPendingObserver } from './webhook/dispatcher.mts';
import { noticeDroppedWork } from './webhook/droppedWorkNotice.mts';
import { createPendingWorkJournal } from './webhook/pendingWorkJournal.mts';
import * as botApi from './lib/botApi.mts';
import os from 'node:os';
import path from 'node:path';
import { logOrganonInjectState } from './lib/organonContext.mts';
import { logVocabInjectState } from './lib/vocabContext.mts';
import { runDoctor } from './lib/doctor.mts';
import { startVoiceLogJanitor } from './routes/voiceChat.mts';
import { migrateAllRoomConfigs } from './lib/roomConfigPaths.mts';

// ★ G-1 (2026-10-27): 部屋の設定を AI の作業場所の外へ移すのは、受け付けを始める前の 1 度だけ
migrateAllRoomConfigs(config.WORKSPACE_ROOT);

// Start server
// ★ 改善ループ 49: AI の仕事の控え。予告なしに止まった (電源断・Windows の再起動・クラッシュ) ときも、
//   次の起動で「中断されました」を知らせるため (pendingWorkJournal.mts)。置き場はリポジトリの外
//   ★ 前の控えは、新しい仕事が上書きする前に読んでおく
const pendingJournal = createPendingWorkJournal(
  process.env.AGENT_PENDING_JOURNAL || path.join(os.homedir(), '.tealus', 'agent', 'pending-work.json'),
);
const leftoverWork = pendingJournal.readLeftover();
pendingJournal.clear();   // ★ 読んだら消す (残すと、次の起動でもう一度知らせてしまう。中身は leftoverWork に持っている)
setPendingObserver((pending) => pendingJournal.record(pending));

const server = app.listen(config.PORT, async () => {
  logger.info(`Agent Server started on port ${config.PORT}`);
  logger.info(`Tealus API: ${config.TEALUS_API_URL}`);
  logger.info(`Light model: ${config.AGENT_LIGHT_MODEL}`);
  // TTS provider のログは config.mts の load 時に出力済み（責務分離）
  logOrganonInjectState(); // organon inject の ON/OFF を起動時に明示（#304、default OFF）
  logVocabInjectState();   // STT vocab inject の ON/OFF を起動時に明示（default OFF、opt-in）
  // ★ codex 経路のモデル可否 (2026-09-11)。採用者環境で Deep が全面停止し、表示が
  //   `auth failed` だったため再ログインへ誤誘導した。★★ ここで「何を設定すればよいか」を出す。
  //   ★★★ 止めはしない —— モデルの可否は外部で変わるので、コードが止めると正しい設定でも動かない。
  //
  // ★ #438: 起動時の診断を doctor に一本化した。checkCodexModels は doctor が中で呼ぶ
  //   (表の照合は f8ac2f1 の実装のまま。作り直していない)。
  //   ★★ 手動の口は `npm run doctor`。同じ判定を人が確かめたいときに叩ける。
  //   ★★★ 外部は叩かない。実測が要るものは別の口に分ける (#438「2 段にする」)。
  for (const f of runDoctor(process.env)) {
    // ★ info も出す。「片方の経路だけ直した」に気づけるのは、警告ではなく一覧の方。
    if (f.level === 'warn') logger.warn(`[doctor] ${f.detail}\n  → ${f.fix}`);
    else logger.info(`[doctor] ${f.id}\n  ${f.detail.split('\n').join('\n  ')}`);
  }

  // ★ 会話の逐語を 1 週間で消す (#389)。会話モードが使われない間も効かせる (書き込み時だけでは残っていた)
  startVoiceLogJanitor();

  // エージェント初期化（Bot APIログイン、ルーム取得、MCP接続）
  // ★ #581 つながるまで試し直す (本体より先に起きても、本体が上がれば AI が返事をする)
  const init = await initializeAgentWithRetry();

  // ★ 改善ループ 49: 前のプロセスが予告なく止まっていたら (控えが残っていた)、その部屋に「中断されました」を知らせる。
  //   計画的な停止では停止の手順が知らせて控えを消すので、ここには来ない。やり直しはしない (11-12 判断「知らせるだけ」)
  if (leftoverWork && init.ok) {
    await noticeDroppedWork(leftoverWork.pending, {
      pushStatus: (roomId, status) => botApi.pushStatus(roomId, status),
      pushMessage: (roomId, content) => botApi.pushMessage(roomId, content),
      log: (line) => logger.warn(line),
    }, 5000, { unplannedSince: leftoverWork.at }).catch(() => {});
  }
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
// ★ 改善ループ 46: 停止は 1 回だけ走らせる。知らせ (最大 3 秒) を足したので「終わらないからもう一度 Ctrl+C」が起きやすく、
//   2 回目が並行に走ると同じ部屋へ知らせが 2 回出る。2 回目は待たずに終わる (後始末が止まったときに押し直せるように)
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) {
    logger.warn('停止処理中に 2 回目の停止の合図を受けたので、待たずに終了します');
    process.exit(130);
  }
  shuttingDown = true;
  logger.info('Shutting down...');
  // ★ cc-queue の購読者に「計画的な停止」を先に伝える (#365)。
  //   これが無いと、別マシンのクライアントは再起動を「予定外の切断」として
  //   毎回通知する。人が毎回予告する運用は忘れられるので、サーバが自分で言う。
  //   クラッシュ時には当然出ない = 予告できないものは異常として残る。
  //   server.close() より先に呼ぶこと (接続を閉じてからでは届かない)。
  try { broadcastShutdown(config.CC_SHUTDOWN_EXPECT_BACK_MS); } catch { /* 停止処理は止めない */ }
  // ★ 終わっていない AI の仕事を、その部屋に知らせてから止める (改善ループ 45)。
  //   列はメモリの中だけにあり、これが無いと黙って消える (11-05 に 7 件)。上限 3 秒で、失敗しても止まる
  await noticeDroppedWork(pendingRooms(), {
    pushStatus: (roomId, status) => botApi.pushStatus(roomId, status),
    pushMessage: (roomId, content) => botApi.pushMessage(roomId, content),
    log: (line) => logger.warn(line),
  }, 3000).catch(() => {});
  // ★ 改善ループ 49: 知らせたので控えを消し、以後は書かない (残すと次の起動で「予告なく止まった」と二重に知らせる)
  setPendingObserver(null);
  pendingJournal.clear();
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
// ★ 改善ループ 49 (2026-11-13): Windows では窓・タブを閉じると SIGHUP が来る (約 10 秒後に強制終了。知らせの上限は 3 秒)。
//   以前は Ctrl+C のときしか「中断しました」の知らせ・購読者への予告が走らなかった。Windows の再起動で来るかは未確認
process.on('SIGHUP', shutdown);
process.on('SIGBREAK', shutdown);   // Ctrl+Break

/**
 * エージェント起動時の初期化
 * - Bot APIにログイン
 * - BotユーザーIDをWebhookハンドラーに登録
 * - 参加中のルーム一覧を取得
 */
const config = require('../config');
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const { registerBotUserId } = require('../webhook/handler');

/**
 * エージェントの初期化
 */
async function initializeAgent() {
  try {
    // Bot APIにログイン
    const token = await botApi.login();
    logger.info('Agent logged in to Tealus');

    // BotユーザーIDを取得してWebhookハンドラーに登録
    // トークンからユーザー情報を取得（Bot APIのレスポンスに含まれる）
    // 簡易的にconfig.TEALUS_BOT_IDを使用
    registerBotUserId(config.TEALUS_BOT_ID, config.TEALUS_BOT_ID);

    // 参加中のルーム一覧を取得
    const roomData = await botApi.getRooms();
    const rooms = roomData.rooms || [];
    logger.info(`Agent is member of ${rooms.length} rooms`);

    for (const room of rooms) {
      logger.debug(`  - ${room.name || 'DM'} (${room.id})`);
    }

    return { rooms };
  } catch (err) {
    logger.error(`Agent initialization failed: ${err.message}`);
    return { rooms: [] };
  }
}

module.exports = { initializeAgent };

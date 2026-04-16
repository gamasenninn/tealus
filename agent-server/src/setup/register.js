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
const { startSweeper } = require('../mcp/roomMcpManager');
const { loadSettings } = require('../context/settingsManager');

/**
 * エージェントの初期化
 */
async function initializeAgent() {
  try {
    // Bot APIにログイン
    const { user } = await botApi.login();
    logger.info('Agent logged in to Tealus');

    // 参加中のルーム一覧を取得
    const roomData = await botApi.getRooms();
    const rooms = roomData.rooms || [];
    logger.info(`Agent is member of ${rooms.length} rooms`);

    // BotユーザーIDとルーム一覧をWebhookハンドラーに登録
    registerBotUserId(user.id, user.display_name, rooms);

    for (const room of rooms) {
      logger.debug(`  - ${room.name || 'DM'} (${room.id})`);
    }

    // エージェント設定読み込み
    loadSettings();

    // MCPキャッシュスイーパー開始（ルームMCPは初回アクセス時に動的接続）
    startSweeper();

    return { rooms };
  } catch (err) {
    logger.error(`Agent initialization failed: ${err.message}`);
    return { rooms: [], mcpServers: [] };
  }
}

module.exports = { initializeAgent };

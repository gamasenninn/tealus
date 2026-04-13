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
const { connectMcpServers } = require('../mcp/manager');

/**
 * エージェントの初期化
 */
async function initializeAgent() {
  try {
    // Bot APIにログイン
    const { user } = await botApi.login();
    logger.info('Agent logged in to Tealus');

    // BotユーザーIDをWebhookハンドラーに登録（UUID）
    registerBotUserId(user.id, user.display_name);

    // 参加中のルーム一覧を取得
    const roomData = await botApi.getRooms();
    const rooms = roomData.rooms || [];
    logger.info(`Agent is member of ${rooms.length} rooms`);

    for (const room of rooms) {
      logger.debug(`  - ${room.name || 'DM'} (${room.id})`);
    }

    // MCP サーバー接続
    const mcpServers = await connectMcpServers();

    return { rooms, mcpServers };
  } catch (err) {
    logger.error(`Agent initialization failed: ${err.message}`);
    return { rooms: [], mcpServers: [] };
  }
}

module.exports = { initializeAgent };

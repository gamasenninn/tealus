/**
 * エージェント起動時の初期化
 * - Bot APIにログイン
 * - BotユーザーIDをWebhookハンドラーに登録
 * - 参加中のルーム一覧を取得
 */
import * as config from '../config.mts';
import { logger } from '../lib/logger.mts';
import * as botApi from '../lib/botApi.mts';
import { registerBotUserId } from '../webhook/handler.mts';
import { startSweeper } from '../mcp/roomMcpManager.mts';
import { loadSettings } from '../context/settingsManager.mts';

export interface InitializeAgentResult {
  rooms: Array<{ id: string; name?: string }>;
  mcpServers?: unknown[];
}

/**
 * エージェントの初期化
 */
export async function initializeAgent(): Promise<InitializeAgentResult> {
  try {
    // Bot APIにログイン
    const { user } = await botApi.login();
    const displayName = (user as { display_name?: string }).display_name;
    logger.info('Agent logged in to Tealus');

    // 参加中のルーム一覧を取得
    const roomData = (await botApi.getRooms()) as { rooms?: Array<{ id: string; name?: string }> };
    const rooms = roomData.rooms || [];
    logger.info(`Agent is member of ${rooms.length} rooms`);

    // BotユーザーIDとルーム一覧をWebhookハンドラーに登録
    registerBotUserId(user.id, displayName, rooms);

    for (const room of rooms) {
      logger.debug(`  - ${room.name || 'DM'} (${room.id})`);
    }

    // エージェント設定読み込み
    loadSettings();

    // MCPキャッシュスイーパー開始（ルームMCPは初回アクセス時に動的接続）
    startSweeper();

    return { rooms };
  } catch (err) {
    logger.error('=================================================');
    logger.error('AGENT INITIALIZATION FAILED');
    logger.error('=================================================');
    logger.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    logger.error('');
    logger.error('agent-server は起動を継続しますが、以下が失敗します:');
    logger.error('  - メッセージへの応答 (botAgentId が未設定のため、webhook 受信時に dispatch でガード skip)');
    logger.error('  - room 一覧の認識 (botRoomIds が空)');
    logger.error('');
    logger.error('Common causes:');
    logger.error('  - Tealus server not reachable (TEALUS_API_URL incorrect)');
    logger.error('  - Bot credentials invalid (TEALUS_BOT_ID / TEALUS_BOT_PASS in agent-server/.env)');
    logger.error('  - Database not reachable (DB_HOST / DB_NAME etc.)');
    logger.error('');
    logger.error('Tealus server / DB / Bot credentials を確認後、agent-server を再起動してください。');
    logger.error('=================================================');
    return { rooms: [], mcpServers: [] };
  }
}

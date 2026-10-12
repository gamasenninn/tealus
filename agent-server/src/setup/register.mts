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
import { startSweeper, warmSharedGlobal } from '../mcp/roomMcpManager.mts';
import { loadSettings } from '../context/settingsManager.mts';

export interface InitializeAgentResult {
  ok: boolean;                                   // #581 試し直すかどうかの判定に使う
  error?: string;                                // #581 失敗の理由 (試し直しの警告に添える)
  rooms: Array<{ id: string; name?: string }>;
  mcpServers?: unknown[];
}

/**
 * エージェントの初期化
 */
export async function initializeAgent(
  { verbose = true }: { verbose?: boolean } = {},   // #581 試し直しの 2 回目以降は大きな表示を出さない
): Promise<InitializeAgentResult> {
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

    // ★ 共有グローバル MCP (tealus・mcp_config.json) を裏で先に起こす (2026-10-02)。
    //   起こさないと、会話モードの 1 回目が tealus MCP の起動 (npx で GitHub から解決、実測 16.5 秒) を待つ。
    //   待たない (起動を遅らせない)。つながらなかった MCP は中で記録され、道具なしで続く (以前と同じ)
    void warmSharedGlobal().catch((err: unknown) => {
      logger.warn(`[RoomMCP] 共有グローバルを先に起こせませんでした: ${err instanceof Error ? err.message : String(err)}`);
    });

    return { ok: true, rooms };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!verbose) return { ok: false, error, rooms: [], mcpServers: [] };
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
    logger.error('つながるまで自動で試し直します (#581)。資格情報の誤りなら .env を直して agent-server を再起動してください。');
    logger.error('=================================================');
    return { ok: false, error, rooms: [], mcpServers: [] };
  }
}

/** #581 試し直しの間隔。最後の値で頭打ち (以降 60 秒ごと) */
export const INIT_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

/** 停止 (SIGINT) を待たせない待ち。テストでは差し替える */
function unrefSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/**
 * #581 起動時の初期化を、つながるまで試し直す。
 * ★ 以前は 1 回きりで、本体より先に agent-server が起きる (起動の順番の取り違え・本体の起動途中) と、
 *   webhook が全部 dispatcher のガードで捨てられ、再起動するまで AI が黙っていた
 * ★ 失敗の警告は 1・2・4・8… 回目だけ (60 秒ごとに続いてもログを埋めない)。つながったら回数を出す
 */
export async function initializeAgentWithRetry(
  { delaysMs = INIT_RETRY_DELAYS_MS, sleep = unrefSleep }: { delaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<InitializeAgentResult> {
  for (let attempt = 1; ; attempt++) {
    const result = await initializeAgent({ verbose: attempt === 1 });
    if (result.ok) {
      if (attempt > 1) logger.info(`[init-retry] ${attempt} 回目でつながりました`);
      return result;
    }
    const delay = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)];
    if ((attempt & (attempt - 1)) === 0) {
      logger.warn(`[init-retry] 初期化に失敗 (${attempt} 回目: ${result.error ?? '不明'})。${Math.round(delay / 1000)} 秒後に試し直します`);
    }
    await sleep(delay);
  }
}

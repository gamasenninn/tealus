/**
 * Dispatcher
 * DM/グループ判定 → メンション検知 → Router → Light/Deep 振り分け
 */
const logger = require('../lib/logger');
const config = require('../config');
const botApi = require('../lib/botApi');
const { route } = require('../router/index');
const { processLight } = require('../agents/light');
const { processLightV2 } = require('../agents/lightV2');
const { processDeep } = require('../agents/deep');
const { processDeepCodex } = require('../agents/deepCodex');
const { loadOrganonPolysemeForPrompt } = require('../lib/organonContext');
const { getOrCreateContext, updateStatus } = require('../context/sessionManager');
const { getOrCreateRoomMcp } = require('../mcp/roomMcpManager');
const { extractPromptFromMessage } = require('../media/messageAdapter');
const fs = require('fs');
const path = require('path');

// ルームごとの処理キュー（並行実行防止）
const roomQueues = new Map();

/**
 * 1 つのキュータスクを外側タイムアウト付きで実行する (#270)。
 * fn が timeoutMs 以内に完了 (resolve / reject) しなければ、強制的に resolve して
 * キューを unblock する。これにより Light v1/v2 path が SDK 内部でハングして Promise が
 * 永久 pending になっても、以降のメッセージがデッドロックしない。
 *
 * 注: タイムアウト時、裏で走っている fn は kill しない (Light v1/v2 は SDK 内部に kill
 * ハンドルが無く、キュー層からは停止できない)。キュー層の責務は「次を通す」ことに限定。
 * プロセス kill は各 path の責務 (Deep は deep.js:121-145 で実装済)。
 * 返り値は決して reject しない (= キューが死なない不変条件)。
 */
function runQueuedTask(roomId, fn, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      logger.error(`Room queue task timeout (${timeoutMs}ms) in room ${roomId}. Forcing resolve to unblock queue (underlying task may still be running).`);
      resolve();
    }, timeoutMs);
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    Promise.resolve().then(fn).then(done).catch((err) => {
      logger.error(`Queue task error in room ${roomId}: ${err.message}`);
      done();
    });
  });
}

async function enqueueForRoom(roomId, fn, timeoutMs = config.QUEUE_TASK_TIMEOUT) {
  const prev = roomQueues.get(roomId) || Promise.resolve();
  const next = prev.then(() => runQueuedTask(roomId, fn, timeoutMs));
  roomQueues.set(roomId, next);
  await next;
}

/**
 * @メンションを検知
 */
function isMentioned(content, agentName) {
  const pattern = new RegExp(`@${agentName}`, 'i');
  return pattern.test(content);
}

/**
 * message.reply_to があれば agent prompt に「reply 先 message を最優先 context にせよ」
 * という instruction を文字列で返す。reply_to がなければ空文字 (既存挙動 retain)。
 *
 * 5/14 朝礼ルーム TODO 抽出 bug 起点 — user が reply_to で「この議事録」と明示しても
 * agent が前回議事録の TODO を verbatim copy していた問題の構造修正。
 *
 * 2-mode behavior:
 * - **content mode** (推奨): `message.reply_to_message.content` が存在する場合、本文を
 *   verbatim で hint に embed。agent は tool call 不要で reply 先 message の本文を
 *   prompt 内に literal に持つ。chat history の対抗 pattern (= 過去 assistant 応答の
 *   echo) より強い signal になり、LLM が history copy する trap を抑制できる。
 * - **id-only fallback** (server 側で reply_to_message を含めていない時): id だけ
 *   embed して agent に get_messages で look up させる。chat history overwhelming
 *   なら通り抜ける弱い form だが、最低限の signal は提供。
 *
 * light/light2/deep 全 path に適用。
 */
function buildReplyToHint(message) {
  if (!message?.reply_to) return '';
  const replyId = message.reply_to;
  const replyMsg = message.reply_to_message;

  if (replyMsg?.content) {
    const senderName = replyMsg.sender_display_name || '不明';
    return `\n\n**重要**: ユーザーは以下の message に返信しています。これが**唯一**の参照対象です:

--- 対象 message (id="${replyId}", from "${senderName}") ---
${replyMsg.content}
--- 対象 message ここまで ---

上記「対象 message」本文のみを context として回答してください。
chat history に類似質問への過去応答 (assistant が以前出した list / 要約等) があっても、絶対に参照・引用・copy しないでください。
output の全ての項目は、上記対象 message 本文に **literal に存在する fact** のみから生成してください。\n`;
  }

  // fallback: id-only (server が reply_to_message を含めていない / fetch 失敗時)
  return `\n\n**重要**: ユーザーは message id="${replyId}" に返信しています。`
       + `get_messages で当該 message を確認し、その内容を context として最優先で扱ってください。`
       + `過去の類似質問への自分の応答を copy せず、reply 先 message の最新内容から再生成してください。\n`;
}

/**
 * メンション部分を除去してプロンプトを抽出
 */
function extractPrompt(content, agentName) {
  const pattern = new RegExp(`@${agentName}\\s*`, 'gi');
  return content.replace(pattern, '').trim();
}

/**
 * メッセージをディスパッチ
 */
async function dispatch({ message, room, agentId, agentName }) {
  const roomId = room.id;

  // ルームごとにシリアライズ（並行実行防止）
  await enqueueForRoom(roomId, () => _dispatch({ message, room, agentId, agentName }));
}

async function _dispatch({ message, room, agentId, agentName }) {
  const roomId = room.id;
  const memberCount = room.member_count || 2;

  // agent-server 初期化失敗の defensive guard (#225)
  // initializeAgent() が失敗すると botAgentId が null のまま webhook が来る → null を path.join に渡して TypeError
  if (!agentId) {
    logger.error(`agent-server is not initialized (botAgentId is null). Cannot dispatch message in room ${roomId}.`);
    logger.error('  This usually means initializeAgent() failed at startup.');
    logger.error('  Check earlier logs for "Agent initialization failed" or "Bot login failed" errors.');
    logger.error('  Common causes:');
    logger.error('    - Tealus server not reachable (TEALUS_API_URL incorrect)');
    logger.error('    - Bot credentials invalid (TEALUS_BOT_ID / TEALUS_BOT_PASS in agent-server/.env)');
    logger.error('    - Database not reachable (DB_HOST / DB_NAME etc.)');
    return;
  }

  // メッセージタイプに応じてプロンプトを抽出
  let prompt = extractPromptFromMessage(message);
  if (!prompt) {
    logger.debug(`Skipped: empty prompt (type: ${message.type})`);
    return;
  }

  // コンテキスト取得/作成
  const context = await getOrCreateContext(agentId, roomId);

  // ルーム設定を読み込み（response_mode）
  let roomSettings = { response_mode: 'auto', enabled: true };
  const roomSettingsPath = path.join(context.workspace_path, 'room_settings.json');
  if (fs.existsSync(roomSettingsPath)) {
    try { roomSettings = JSON.parse(fs.readFileSync(roomSettingsPath, 'utf8')); } catch {}
  }

  // エージェント無効
  if (!roomSettings.enabled || roomSettings.response_mode === 'off') {
    logger.debug(`Skipped: agent disabled in room ${room.name || roomId}`);
    return;
  }

  // 応答モードに応じたメンション判定
  const needsMention =
    roomSettings.response_mode === 'mention' ? true :
    roomSettings.response_mode === 'all' ? false :
    /* auto */ memberCount > 2;

  if (needsMention) {
    if (!isMentioned(prompt, agentName)) {
      logger.debug(`Skipped: no mention in ${room.name || roomId}`);
      return;
    }
    prompt = extractPrompt(prompt, agentName);
  }

  // Router で振り分け
  const result = await route(prompt);

  switch (result.tier) {
    case 'router':
      // Router直接応答（挨拶等）
      await botApi.pushMessage(roomId, result.response);
      logger.info(`Router direct: "${result.response.slice(0, 30)}..." → room ${roomId}`);
      break;

    case 'unavailable': {
      // Deep が明示指定されたが provider 対応 CLI 不在 (#276 provider-aware)
      const unavailMsg = result.provider === 'codex'
        ? 'ℹ️ Deep agent (Codex) は codex CLI + ChatGPT subscription (Plus/Pro/Team) が必要です。\n'
          + 'セットアップ: `codex login` 実行後 agent-server 再起動。\n'
          + '通常の質問は Light で対応できます (`/deep` を付けないでください)。'
        : 'ℹ️ Deep agent は Claude Code CLI（Claude MAX 契約）が必要です。\n'
          + 'セットアップ方法は README の Tier 表を参照ください。\n'
          + '通常の質問は Light で対応できます（`/deep` を付けないでください）。';
      await botApi.pushMessage(roomId, unavailMsg);
      logger.info(`Router: unavailable response → room ${roomId} (${result.provider || 'claude'} CLI not found)`);
      break;
    }

    case 'light': {
      // Light Agent (#292: AGENT_LIGHT_BACKEND config で V1/V2/自作 を動的解決)
      const { loadLightBackend } = require('../agents/lightBackendLoader');
      const backend = loadLightBackend(config.AGENT_LIGHT_BACKEND);

      await updateStatus(agentId, roomId, 'processing');
      try {
        // V1 のみ MCPServerStdio instances を外側で構築、V2/自作 は内部 build で済むため skip
        const mcpServers = backend.name === 'v1'
          ? await getOrCreateRoomMcp(agentId, roomId, context.workspace_path)
          : undefined;
        // Deep pattern を Light でも踏襲: room_id を user prompt に embed
        const userPrompt = result.prompt || prompt;
        const lightPrompt = `現在のルーム ID: ${roomId}${buildReplyToHint(message)}

ユーザーの質問: ${userPrompt}`;

        await backend.processLight({
          roomId,
          prompt: lightPrompt,
          workspacePath: context.workspace_path,
          agentId,
          mcpServers,
        });
      } finally {
        await updateStatus(agentId, roomId, 'idle');
      }
      break;
    }

    case 'light2': {
      // #258 Light v2 Agent (codex-sdk backed、並列追加)
      // MCP は lightV2.js 内で直接構築する (Light v1 の MCPServerStdio instances は不要)
      await updateStatus(agentId, roomId, 'processing');
      try {
        const userPrompt = result.prompt || prompt;
        const lightPrompt = `現在のルーム ID: ${roomId}${buildReplyToHint(message)}

ユーザーの質問: ${userPrompt}`;

        await processLightV2({
          roomId,
          prompt: lightPrompt,
          workspacePath: context.workspace_path,
        });
      } finally {
        await updateStatus(agentId, roomId, 'idle');
      }
      break;
    }

    case 'deep': {
      // Deep Agent（claude -p / codex exec + Tealus MCP）
      // AI が自律的に MCP ツールで会話履歴を取得して回答
      // #276: DEEP_AGENT_PROVIDER=codex で processDeepCodex に切替
      await updateStatus(agentId, roomId, 'processing');
      try {
        const userPrompt = result.prompt || prompt;
        const deepPrompt = `あなたは Tealus メッセンジャーの AI アシスタントです。
Tealus MCP ツール（tealus サーバー）を使って情報を取得し、ユーザーの質問に回答してください。

現在のルーム ID: ${roomId}${buildReplyToHint(message)}
まず get_messages ツールでこのルームの直近の会話を確認してから回答してください。

議事録 / 業務記録 生成時は、後述する organon polyseme entries (= 業務語彙 + alias + mapping) を参照し、以下の方針で出力してください:
- 既知 entry の alias は正規名に訂正 (例: 「マサ→山崎整備長」「ソートメ→五月女」)
- 確信度低い推測 / organon 未登録は本文中 **[要確認: 元音声]** marker のみ表記 (= reasoning は本文に書かない)
- 議事録末尾に **「## organon 記法 注意事項」** section を追加し、[要確認] 各項目の reasoning (= organon entry / alias family / 揺らぎ pattern / sub-family 等) を集約

ユーザーの質問: ${userPrompt}${loadOrganonPolysemeForPrompt()}`;

        if (config.DEEP_AGENT_PROVIDER === 'codex') {
          // MCP servers は deepCodex 内部で Light v2 同型 builder で構築 (= mcpServers 未指定)
          await processDeepCodex({
            roomId,
            prompt: deepPrompt,
            workspacePath: context.workspace_path,
            agentId,
            sessionId: context.session_id,
          });
        } else {
          await processDeep({
            roomId,
            prompt: deepPrompt,
            workspacePath: context.workspace_path,
            agentId,
            sessionId: context.session_id,
          });
        }
      } finally {
        await updateStatus(agentId, roomId, 'idle');
      }
      break;
    }

    default:
      logger.warn(`Unknown tier: ${result.tier}`);
  }
}

module.exports = { isMentioned, extractPrompt, dispatch, enqueueForRoom };

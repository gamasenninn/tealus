/**
 * Dispatcher
 * DM/グループ判定 → メンション検知 → Router → Light/Deep 振り分け
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../lib/logger.mts';
import * as config from '../config.mts';
import * as botApi from '../lib/botApi.mts';
import * as inflightRooms from './inflightRooms.mts';
import { route } from '../router/index.mts';
import { parseMultiDelegation } from './delegationParser.mts';
import { handleDelegation, handleMultiDelegation, parseErrorMessage } from './delegator.mts';
import { processLightV2 } from '../agents/lightV2.mts';
import { processDeep } from '../agents/deep.mts';
import { processDeepCodex } from '../agents/deepCodex.mts';
import { loadLightBackend } from '../agents/lightBackendLoader.mts';
import { loadOrganonPolysemeForPrompt } from '../lib/organonContext.mts';
import { loadVocabForPrompt } from '../lib/vocabContext.mts';
import { getOrCreateContext, updateStatus } from '../context/sessionManager.mts';
import { getOrCreateRoomMcp } from '../mcp/roomMcpManager.mts';
import { extractPromptFromMessage } from '../media/messageAdapter.mts';
import { isMentioned } from './mention.mts';
import type { WebhookMessage, DispatchParams } from '../types.mts';

// ルームごとの処理キュー（並行実行防止）
const roomQueues = new Map<string, Promise<void>>();

/**
 * 1 つのキュータスクを外側タイムアウト付きで実行する (#270)。
 * fn が timeoutMs 以内に完了 (resolve / reject) しなければ、強制的に resolve して
 * キューを unblock する。これにより Light v1/v2 path が SDK 内部でハングして Promise が
 * 永久 pending になっても、以降のメッセージがデッドロックしない。
 *
 * 注: タイムアウト時、裏で走っている fn は kill しない (Light v1/v2 は SDK 内部に kill
 * ハンドルが無く、キュー層からは停止できない)。キュー層の責務は「次を通す」ことに限定。
 * プロセス kill は各 path の責務 (Deep は deep.mts で実装済)。
 * 返り値は決して reject しない (= キューが死なない不変条件)。
 */
function runQueuedTask(roomId: string, fn: () => unknown, timeoutMs: number): Promise<void> {
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
      logger.error(`Queue task error in room ${roomId}: ${err instanceof Error ? err.message : String(err)}`);
      done();
    });
  });
}

export async function enqueueForRoom(roomId: string, fn: () => unknown, timeoutMs: number = config.QUEUE_TASK_TIMEOUT): Promise<void> {
  const prev = roomQueues.get(roomId) || Promise.resolve();
  const next = prev.then(() => runQueuedTask(roomId, fn, timeoutMs));
  roomQueues.set(roomId, next);
  await next;
}

// @メンション検知は mention.mts に切り出し（handler と共有・依存分離）。既存 import 互換で re-export。
export { isMentioned };

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
function buildReplyToHint(message: WebhookMessage): string {
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
export function extractPrompt(content: string, agentName: string): string {
  const pattern = new RegExp(`@${agentName}\\s*`, 'gi');
  return content.replace(pattern, '').trim();
}

/**
 * ルームトリガーの「自動投稿の印」を prompt から除去する (#388)
 *
 * 印は **人間が自動投稿を見分けるためのもの**で、agent への指示ではない。
 * 剥がさないと `ユーザーの質問: ... — 自動投稿 (room-triggers: xxx)` として
 * 依頼文の一部に混ざる (2026-08-24 の朝礼で実際に混ざっていた)。
 *
 * 非自明な約束事:
 * - **投稿本文からは消さない。**落とすのは agent に渡す prompt だけ。
 *   印は server 側 `roomTriggers.mts §3.1.1` で「前回撃った時刻」の検索キーに使う。
 *   本文から消すとトリガーが自分の前回発火を見失う。
 * - 形は server 側 `markFor()` が決める: `— 自動投稿 (room-triggers: <id>)`。
 *   **行全体**が一致する時だけ落とす (引用・説明文の中の同じ文字列は残す)。
 * - 先頭メンションは 1 行目にあるので、印を落としても `isMentioned` は生きている
 *   (落とすと agent が起動しない = 機能そのものが動かない。docs/06 §10 と同じ罠)。
 */
export function stripAutoPostMark(content: string | null | undefined): string {
  if (!content) return '';
  return content
    .split('\n')
    .filter((line) => !/^\s*—\s*自動投稿\s*\(room-triggers:[^)]*\)\s*$/.test(line))
    .join('\n')
    .trim();
}

/**
 * Light/Light2 用 prompt 構築 (#295: 通常 dispatch と委譲 runAgent で共有)
 */
function buildLightPrompt(roomId: string, userPrompt: string, replyHint = ''): string {
  return `現在のルーム ID: ${roomId}${replyHint}

ユーザーの質問: ${userPrompt}`;
}

/**
 * Deep 用 prompt 構築 (#295: 通常 dispatch と委譲 runAgent で共有)
 */
function buildDeepPrompt(roomId: string, userPrompt: string, replyHint = ''): string {
  return `あなたは Tealus メッセンジャーの AI アシスタントです。
Tealus MCP ツール（tealus サーバー）を使って情報を取得し、ユーザーの質問に回答してください。

現在のルーム ID: ${roomId}${replyHint}
まず get_messages ツールでこのルームの直近の会話を確認してから回答してください。

議事録 / 業務記録 生成時は、後述する organon polyseme entries (= 業務語彙 + alias + mapping) を参照し、以下の方針で **必ず** 出力してください:

1. **alias 訂正 (= 確信度高)**: 既知 entry の alias 完全一致は正規名に訂正 (例: 「マサ→山崎整備長」「ソートメ→五月女」「三平→三瓶」)。元音声を残す必要なし。
2. **推測可能 alias (= 確信度中)**: organon entry に類似 alias / sub-family pattern (= 「マ」prefix / 漢字頭部置換 / 業務句 hallucination 等) があれば、本文に **[要確認: 推測正規名 か、音声上は「元音声」]** 形式で記載 (例: 「[要確認: 山崎整備長 か、音声上は「上山」]」「[要確認: 三瓶 か、音声上は「三平」]」)。
3. **未登録 / 確信度低**: 本文に **[要確認: 音声上「元音声」]** marker のみ (= 推測なし)。
4. **末尾 section 必須**: 本文に [要確認] が 1 つでもあれば、議事録末尾に **「## organon 記法 注意事項」** section を **必ず** 追加してください。各 [要確認] 項目の reasoning (= 該当 organon entry / alias family / sub-family pattern / 揺らぎ pattern / 推測根拠 等) を集約。[要確認] が 0 件なら section 省略 OK。

ユーザーの質問: ${userPrompt}${loadOrganonPolysemeForPrompt()}${loadVocabForPrompt()}`;
}

/**
 * メッセージをディスパッチ
 */
export async function dispatch({ message, room, agentId, agentName }: DispatchParams): Promise<void> {
  const roomId = room.id;

  // #292 SPIKE: cross-room delegation 有効時、in-flight tracking で
  // 同 room 自送 echo を block し別 room delegation post を通すための判別 source
  const spikeEnabled = process.env.ENABLE_CROSS_ROOM_DELEGATION === 'true';
  if (spikeEnabled) inflightRooms.add(roomId);
  try {
    // ルームごとにシリアライズ（並行実行防止）
    await enqueueForRoom(roomId, () => _dispatch({ message, room, agentId, agentName }));
  } finally {
    if (spikeEnabled) inflightRooms.release(roomId);
  }
}

async function _dispatch({ message, room, agentId, agentName }: DispatchParams): Promise<void> {
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
  // #388: 自動投稿の印はここで落とす。mention 判定より前だが 1 行目は残るので影響しない。
  //       DM (mention 不要) 経路も通るよう extractPrompt ではなくこの位置に置く。
  let prompt = stripAutoPostMark(extractPromptFromMessage(message));
  if (!prompt) {
    logger.debug(`Skipped: empty prompt (type: ${message.type})`);
    return;
  }

  // コンテキスト取得/作成
  const context = await getOrCreateContext(agentId, roomId);

  // ルーム設定を読み込み（response_mode）
  let roomSettings: { response_mode: string; enabled: boolean } = { response_mode: 'auto', enabled: true };
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
    // isMentioned が true を返した時点で agentName は非 null (invariant)
    prompt = extractPrompt(prompt, agentName!);
  }

  // #295: `%<room> <task>` 委譲検出 (mention 処理後・route 前)。
  // ENABLE_CROSS_ROOM_DELEGATION フラグ配下、先頭 `%` のメッセージのみ getRooms を引く。
  const delegationEnabled = process.env.ENABLE_CROSS_ROOM_DELEGATION === 'true';
  if (delegationEnabled && prompt.trimStart().startsWith('%')) {
    let rooms: Array<{ id: string; name: string }> = [];
    try {
      const roomData = await botApi.getRooms();
      rooms = roomData.rooms || [];
    } catch (err) {
      logger.warn(`[delegator] getRooms failed, skip delegation: ${err instanceof Error ? err.message : String(err)}`);
    }
    const parsed = parseMultiDelegation(prompt, rooms);
    if (parsed) {
      // 先頭 `%` = 委譲試行。route() へは流さない。
      if (!parsed.ok) {
        logger.info(`[delegator] parse failed: reason=${parsed.reason} room ${roomId}`);
        await botApi.pushMessage(roomId, parseErrorMessage(parsed.reason)).catch(() => {});
        return;
      }

      // #282 権限チェック: 委譲先ルームのメンバーのみ。target ごとに判定 (fail-closed)。
      const senderId = message.sender?.id;
      const requireMembership = process.env.DELEGATION_REQUIRE_MEMBERSHIP !== 'false';
      const permitted: Array<{ id: string; name: string }> = [];
      const skipped: string[] = [];
      for (const t of parsed.targets) {
        if (!requireMembership) { permitted.push(t); continue; }
        let allowed = false;
        try {
          allowed = senderId ? await botApi.isRoomMember(t.id, senderId) : false;
        } catch (err) {
          logger.warn(`[delegator] membership check failed (fail-closed) for ${t.id}: ${err instanceof Error ? err.message : String(err)}`);
          allowed = false;
        }
        if (allowed) permitted.push(t);
        else skipped.push(t.name);
      }
      if (permitted.length === 0) {
        logger.info(`[delegator] permission denied: sender=${senderId} not member of any target`);
        await botApi.pushMessage(roomId, `⚠️ 「${parsed.targets.map((t) => t.name).join('・')}」のメンバーではないため委譲できません。`).catch(() => {});
        return;
      }
      if (skipped.length > 0) {
        await botApi.pushMessage(roomId, `⚠️ 権限がないため除外: ${skipped.join('・')}`).catch(() => {});
      }

      // 委譲先で「普段どおり」回答 (route ベース tier 選択 + suppressAutoPost + inflight + no-post prefix)。
      const runAgent = async (targetRoomId: string, task: string): Promise<string | null | undefined> => {
        const tctx = await getOrCreateContext(agentId, targetRoomId);
        const r = await route(task);
        const userPrompt = r.prompt || task;
        const useDeepCodex = r.tier === 'deep' && config.DEEP_AGENT_PROVIDER === 'codex';
        const noPostPrefix = '**重要**: あなたは別のルームからの委譲依頼に回答しています。回答は本文として述べるだけにし、send_message ツールでこのルームに投稿しないでください（投稿は委譲元が行います）。\n\n';
        let out: string | null | undefined = null;
        inflightRooms.add(targetRoomId);
        try {
          await enqueueForRoom(targetRoomId, async () => {
            if (useDeepCodex) {
              out = await processDeepCodex({ roomId: targetRoomId, prompt: noPostPrefix + buildDeepPrompt(targetRoomId, userPrompt), workspacePath: tctx.workspace_path, agentId, sessionId: tctx.session_id, suppressAutoPost: true });
            } else {
              out = await processLightV2({ roomId: targetRoomId, prompt: noPostPrefix + buildLightPrompt(targetRoomId, userPrompt), workspacePath: tctx.workspace_path, suppressAutoPost: true });
            }
          });
        } finally {
          inflightRooms.release(targetRoomId);
        }
        logger.info(`[delegator] runAgent target=${targetRoomId} tier=${useDeepCodex ? 'deep-codex' : 'light'}`);
        return out;
      };

      // synthesize: origin で N 室結果を統合。origin queue 内なので enqueueForRoom せず直接実行 (再入防止)。
      const synthesize = async (task: string, sections: Array<{ name: string; text: string }>): Promise<string | null | undefined> => {
        const octx = await getOrCreateContext(agentId, roomId);
        const r = await route(task);
        const useDeepCodex = r.tier === 'deep' && config.DEEP_AGENT_PROVIDER === 'codex';
        const sectionText = sections.map((s) => `【${s.name} より】\n${s.text}`).join('\n\n');
        const synthPrompt = `あなたは複数ルームから集めた結果を、ユーザの依頼に従って1つに統合します。\nユーザの依頼: ${r.prompt || task}\n\n以下は各ルームからの結果です。依頼に沿って統合してください（「(応答なし)」は無理に補完しない）。\n\n${sectionText}`;
        if (useDeepCodex) {
          return processDeepCodex({ roomId, prompt: synthPrompt, workspacePath: octx.workspace_path, agentId, sessionId: octx.session_id, suppressAutoPost: true });
        }
        return processLightV2({ roomId, prompt: synthPrompt, workspacePath: octx.workspace_path, suppressAutoPost: true });
      };

      const deps = { runAgent, synthesize, postToRoom: async (rid: string, text: string): Promise<void> => { await botApi.pushMessage(rid, text); } };

      const statusMsg = permitted.length === 1
        ? `${permitted[0].name} に問い合わせ中...`
        : `${permitted.length}室に問い合わせ中...`;
      await botApi.pushStatus(roomId, 'processing', statusMsg).catch(() => {});
      logger.info(`[delegator] % delegation: origin=${roomId} targets=[${permitted.map((t) => t.name).join(',')}] task="${parsed.task.slice(0, 40)}"`);
      try {
        if (permitted.length === 1) {
          await handleDelegation({ originRoomId: roomId, targetRoom: permitted[0], task: parsed.task }, deps);
        } else {
          await handleMultiDelegation({ originRoomId: roomId, targets: permitted, task: parsed.task }, deps);
        }
      } finally {
        await botApi.pushStatus(roomId, 'idle').catch(() => {});
      }
      return;
    }
  }

  // Router で振り分け
  const result = await route(prompt);

  switch (result.tier) {
    case 'router':
      // Router直接応答（挨拶等）。#303: 失敗時は偽の成功ログを残さず error log。
      try {
        // tier='router' の時 response は常に設定される (router/index.mts の invariant)
        await botApi.pushMessage(roomId, result.response!);
        logger.info(`Router direct: "${result.response!.slice(0, 30)}..." → room ${roomId}`);
      } catch (err) {
        logger.error(`[dispatcher] router direct NOT delivered to room ${roomId}: ${err instanceof Error ? err.message : String(err)}`);
      }
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
      try {
        await botApi.pushMessage(roomId, unavailMsg);
        logger.info(`Router: unavailable response → room ${roomId} (${result.provider || 'claude'} CLI not found)`);
      } catch (err) {
        logger.error(`[dispatcher] unavailable notice NOT delivered to room ${roomId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case 'light': {
      // Light Agent (#292: AGENT_LIGHT_BACKEND config で V1/V2/自作 を動的解決)
      const backend = loadLightBackend(config.AGENT_LIGHT_BACKEND);

      await updateStatus(agentId, roomId, 'processing');
      try {
        // V1 のみ MCPServerStdio instances を外側で構築、V2/自作 は内部 build で済むため skip
        const mcpServers = backend.name === 'v1'
          ? await getOrCreateRoomMcp(agentId, roomId, context.workspace_path)
          : undefined;
        // Deep pattern を Light でも踏襲: room_id を user prompt に embed
        const userPrompt = result.prompt || prompt;
        const lightPrompt = buildLightPrompt(roomId, userPrompt, buildReplyToHint(message));

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
      // MCP は lightV2.mts 内で直接構築する (Light v1 の MCPServerStdio instances は不要)
      await updateStatus(agentId, roomId, 'processing');
      try {
        const userPrompt = result.prompt || prompt;
        const lightPrompt = buildLightPrompt(roomId, userPrompt, buildReplyToHint(message));

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
        const deepPrompt = buildDeepPrompt(roomId, userPrompt, buildReplyToHint(message));

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

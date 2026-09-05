/**
 * #405 Realtime 音声会話モード — ブラウザと OpenAI を繋ぐための 3 つの口 (docs/08 §12)。
 *
 * ★ 音声はここを通らない。ブラウザ ↔ OpenAI の直通で、サーバに 1 バイトも来ない。
 *   ここがやるのは (1) 使い捨てトークンの発行 (2) 道具の実行 (3) 計測の受け取り の 3 つだけ。
 *
 * ★ なぜ agent-server に置くか (docs/08 §12):
 *   - `OPENAI_API_KEY` がここにある / `authenticate` が本体と JWT_SECRET を共有している
 *   - ★ **ルームごとの MCP を解決する仕組み (roomMcpManager) がここにしかない**
 *   別の場所に作ると同じものをもう一度書くことになる。
 *
 * ★★ 既定経路 (Light v2) には in-process の MCP が存在しない (v2 は codex CLI に設定を渡すだけ)。
 *   したがってここは **`getOrCreateRoomMcp` を自分で呼んで同じ 3 層を起こす**。
 *   「動いているものを流用する」のではない。冷間起動は遅いので **セッション発行時に済ませ、
 *   会話中には乗せない** (docs/08 §12.4-2)。
 *
 * ★★★★ 検証が二段ある理由 (docs/08 §12.4-4):
 *   WebRTC では道具を実行するのが**ブラウザ**。発行時に道具を絞っても、壊れた/悪意ある
 *   クライアントは道具の口へ任意の名前を直接投げられる。こちらは OpenAI と繋がっていないので
 *   `call_id` の真正性も確かめられない。→ **台帳を持ち、実行時にも 3 点を検証する。**
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import * as config from '../config.mts';
import { logger } from '../lib/logger.mts';
import { getOrCreateRoomMcp } from '../mcp/roomMcpManager.mts';
import { getBotIdentity } from '../webhook/handler.mts';

export const router = express.Router();

/**
 * ★ 会話モードに出す道具は明示リストで絞る。理由が 2 つある:
 *   1. 破壊的な道具を音声から誤爆させない (「消しといて」が通ると戻せない)
 *   2. ~~関数方式は道具の説明文を毎セッション渡すので、増えるほど遅くなる~~
 *      ★★ **訂正 (2026-09-05): 測ったら効かなかった。** 6 → 9 に増やして比較:
 *      ```
 *      tools=6  n=54  中央値 1.05s  2 秒以内 52/54
 *      tools=9  n=22  中央値 1.02s  2 秒以内 20/22   ← ★ むしろ速い (誤差)
 *      ```
 *      **この規模 (数個) では観測されない。** 大きく増やしたときは測り直すこと。
 *      ★ したがって**このリストが立っている根拠は 1 だけ**である。
 * 試作は read 系 + 昇格用の送信だけ。増やすときは①を測り直してから。
 * ★ 参考 (2026-09-05 実測): `tavily_search` が 5220ms かかったターンでも**声は 2.14s で返った**。
 *   「道具を呼ぶ前に一言つなぐ」を instructions に入れてあるので、**道具の遅さは①に出にくい**。
 *
 * ★★ **ここは「tealus の破壊的な道具」を守るためのリストである** (2026-09-05 に取り違えを直した)。
 *   ルーム固有の MCP (社内DB 等) の道具まで巻き添えで捨てていた —— 起動して道具一覧を
 *   取ったうえで捨てるので、**起動コストだけ払って何も得ていなかった** (接続 4.2s の正体)。
 *   → ルームごとに `rooms.voice_conversation_tools` で**名指しした道具を上乗せ**できる。
 */
const BASE_TOOLS = new Set([
  'get_messages',
  'search_messages',
  'list_rooms',
  'list_tags',
  'read_document',
  'send_message',   // 昇格 (docs/08 §1.2.2 の成立条件)
]);

/**
 * ★ そのルームで上乗せする道具。**DB の列から来る** (`rooms.voice_conversation_tools`)。
 *
 * ★★ `room_settings.json` には置かない。`PUT /config/room/:roomId/settings` は認証のみで
 *   メンバー確認も管理者確認も無く、**誰でも任意のルームに `execute_sql` を足せてしまう**。
 *   会話モードを開く判定と同じ場所・同じ門 (`PUT /api/rooms/:id` = requireRoomAdmin) に置く。
 * ★ 既定は空。**何もしなければ 1 つも増えない。**
 */
function extraToolsOf(room: Record<string, unknown>): Set<string> {
  const raw = room.voice_conversation_tools;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x): x is string => typeof x === 'string' && !!x.trim()));
}

/** MCP の道具 1 つ。inputSchema は JSON Schema そのものなので、そのまま parameters にできる */
interface McpToolLike {
  name: string;
  description?: string;
  inputSchema?: unknown;
}
interface McpServerLike {
  listTools: () => Promise<McpToolLike[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

interface SessionEntry {
  userId: string;
  roomId: string;
  allowedTools: Set<string>;
  serverOf: Map<string, McpServerLike>;
  issuedAt: number;
}

/** セッション台帳。TTL を過ぎたものは掃除する (プロセス内。再起動で消えてよい) */
const sessions = new Map<string, SessionEntry>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function sweep(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.issuedAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

/** テスト用。台帳を空にする */
export function _resetForTest(): void {
  sessions.clear();
}

/** JWT のペイロードから呼び出し元の user id を取る */
function callerId(req: Request): string | null {
  const u = (req as Request & { user?: { id?: string } }).user;
  return u && typeof u.id === 'string' ? u.id : null;
}

/**
 * 呼び出し元のトークンで本体の `GET /api/rooms/:id` を引く。
 * ★ これ 1 回で **参加しているか (requireMember が 403 を返す) と、開けてよいルームか (列)** の
 *   両方が分かる。認可を本体に委ねるのは ccQueue の前例と同じ (agent-server は DB を引かない)。
 */
async function resolveRoom(req: Request, roomId: string): Promise<{ ok: true; room: Record<string, unknown> } | { ok: false; status: number }> {
  const auth = req.headers.authorization as string;
  const res = await fetch(`${config.TEALUS_API_URL}/api/rooms/${roomId}`, {
    headers: { Authorization: auth },
  } as RequestInit);

  if (res.status === 401) return { ok: false, status: 401 };
  if (res.status === 403 || res.status === 404) return { ok: false, status: 403 };
  if (!res.ok) return { ok: false, status: 502 };

  const body = await res.json() as { room?: Record<string, unknown> };
  if (!body.room) return { ok: false, status: 502 };
  return { ok: true, room: body.room };
}

/** MCP の道具 → Realtime の関数宣言。inputSchema は JSON Schema なので変換は名前の付け替えだけ */
function toFunctionTools(tools: McpToolLike[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description || '',
    parameters: t.inputSchema || { type: 'object', properties: {} },
  }));
}

/**
 * ★ instructions は最小にする。
 *   既存経路が毎ターン約 96,000 tokens を読んでいて、それが遅さの正体だった (docs/08 §2.4)。
 *   **同じことを Realtime で繰り返さない** — 辞書も light_prompt.md も入れない。
 *   過去のやりとりは「毎回読ませる」のではなく「必要なときに道具で引く」に変える。
 */
function buildInstructions(roomName: string): string {
  return [
    `あなたは社内メッセンジャー Tealus の「${roomName}」ルームで、音声で会話するアシスタントです。`,
    '過去のやりとりは道具 (get_messages / search_messages) で引けます。必要になったときだけ引いてください。',
    '★ 道具を呼ぶ前に「確認しますね」のように一言だけ挟んでください (黙って待たせない)。',
    '話し言葉で、短く答えてください。聞かれていないことを足さないこと。',
    '役職や呼び方はそのまま残してください。人物のフルネームに言い換えないこと。',
  ].join('\n');
}

/**
 * POST /voice-chat/session — 会話を始める。
 * ★ ここが遅くてよい唯一の場所。MCP の冷間起動 (最悪 30 秒級) をここで吸収し、会話中に乗せない。
 */
router.post('/session', async (req, res) => {
  const userId = callerId(req);
  const roomId = typeof req.body?.room_id === 'string' ? req.body.room_id : '';
  if (!userId) return res.status(401).json({ error: '認証が必要です' });
  if (!roomId) return res.status(400).json({ error: 'room_id が必要です' });

  try {
    const resolved = await resolveRoom(req, roomId);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: 'このルームでは会話モードを使えません' });
    }
    // ★ 既定 false。開けていないルームは、参加していても開けない (docs/08 §4.1 の理由②)
    if (!resolved.room.voice_conversation_enabled) {
      return res.status(403).json({ error: 'このルームでは会話モードが有効になっていません' });
    }

    const agentId = getBotIdentity().user_id;
    if (!agentId) return res.status(503).json({ error: 'アシスタントが起動していません' });

    // MCP を温める + 道具一覧を取る。1 つのサーバが落ちても会話は始められるようにする
    const workspacePath = path.join(config.WORKSPACE_ROOT, agentId, roomId);
    const servers = await getOrCreateRoomMcp(agentId, roomId, workspacePath) as unknown as McpServerLike[];

    // ★ そのルームで許す道具 = 共通の 6 個 + ルームが名指しした分
    const allowed = new Set([...BASE_TOOLS, ...extraToolsOf(resolved.room)]);
    const serverOf = new Map<string, McpServerLike>();
    const picked: McpToolLike[] = [];
    const dropped: string[] = [];
    for (const s of servers) {
      let tools: McpToolLike[];
      try {
        tools = await s.listTools();
      } catch (err) {
        logger.warn(`[voice-chat] listTools 失敗 (この MCP は道具なしで続行): ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      for (const t of tools) {
        if (serverOf.has(t.name)) continue;
        if (!allowed.has(t.name)) { dropped.push(t.name); continue; }
        serverOf.set(t.name, s);
        picked.push(t);
      }
    }

    const roomName = typeof resolved.room.name === 'string' ? resolved.room.name : 'このルーム';
    const sessionConfig = {
      session: {
        type: 'realtime',
        model: config.REALTIME_MODEL,
        instructions: buildInstructions(roomName),
        tools: toFunctionTools(picked),
        tool_choice: 'auto',
        audio: {
          // ★ turn_detection: null = サーバ側の発話検知を切る = 押して話す (docs/08 §5.1)
          input: { turn_detection: null, transcription: { model: 'gpt-4o-mini-transcribe' } },
        },
      },
    };

    const secretRes = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,   // ★ ブラウザには絶対に出さない
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionConfig),
    } as RequestInit);

    if (!secretRes.ok) {
      const detail = await secretRes.text().catch(() => '');
      logger.error(`[voice-chat] client_secrets が ${secretRes.status}: ${detail.slice(0, 300)}`);
      return res.status(502).json({ error: '音声セッションを開始できませんでした' });
    }
    const secret = await secretRes.json() as { value?: string };

    sweep();
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      userId, roomId,
      allowedTools: new Set(serverOf.keys()),
      serverOf,
      issuedAt: Date.now(),
    });

    // ★ 捨てた道具の名前も出す。管理者が「このルームで何を足せるか」を知る手段がこれしかない
    logger.info(`[voice-chat] session ${sessionId.slice(0, 8)} room=${roomId} tools=${picked.length} by ${userId}`
      + (dropped.length ? ` (未許可: ${dropped.join(', ')})` : ''));
    res.json({ session_id: sessionId, client_secret: secret.value, model: config.REALTIME_MODEL });
  } catch (err) {
    logger.error(`[voice-chat] session error: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: '音声セッションの開始に失敗しました' });
  }
});

/**
 * POST /voice-chat/tool-call — ブラウザが受け取った道具の要求を、こちらで実行する。
 * ★ 二段目の検証はここ。発行時に絞ってあることを信用しない (実行者がブラウザなので)。
 */
router.post('/tool-call', async (req, res) => {
  const userId = callerId(req);
  const { session_id: sessionId, name, arguments: rawArgs } = req.body || {};
  if (!userId) return res.status(401).json({ error: '認証が必要です' });

  const entry = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
  //  3 点とも落ちたら同じ 403 にする (どれで落ちたかを外に教えない)
  if (!entry || entry.userId !== userId || typeof name !== 'string' || !entry.allowedTools.has(name)) {
    logger.warn(`[voice-chat] 道具の要求を拒否: session=${String(sessionId).slice(0, 8)} name=${name} by ${userId}`);
    return res.status(403).json({ error: 'この道具は使えません' });
  }

  const started = Date.now();
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(String(rawArgs)) : {};
  } catch {
    // 引数が壊れていてもモデルに返して直させる (会話を止めない)
    return res.json({ output: '引数の JSON が壊れています。組み立て直してください。', elapsed_ms: 0 });
  }

  try {
    const result = await entry.serverOf.get(name)!.callTool(name, args);
    const output = typeof result === 'string' ? result : JSON.stringify(result);
    logger.info(`[voice-chat] tool ${name} ${Date.now() - started}ms session=${sessionId.slice(0, 8)}`);
    res.json({ output, elapsed_ms: Date.now() - started });
  } catch (err) {
    // ★ 500 にしない。道具が失敗したことをモデルに伝えて、会話は続けさせる
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[voice-chat] tool ${name} 失敗: ${message}`);
    res.json({ output: `道具の実行に失敗しました: ${message}`, elapsed_ms: Date.now() - started });
  }
});

/**
 * POST /voice-chat/promote — ★ 昇格 (R3、docs/08 §1.2.2)。
 *
 * 会話の中の「良かった 1 つ」を、**いま居るルーム**へ残す。
 *
 * ★★ **これが無い会話モードは作らない**、が設計書の成立条件。捨てるだけなら ChatGPT でよく、
 *   Tealus にしかできないのは「捨てる前提で話した中から、良かった 1 つを組織記憶へ上げる」こと。
 *
 * ★ **行き先は client に選ばせない。** 会話はそのルームから開いているので、昇格先はそのルーム。
 *   body に room_id が来ても無視する (session の room が唯一の正)。
 *
 * ★★★ **失敗は必ず返す。** tool-call は会話を止めないために失敗を飲み込むが、昇格は
 *   **残ったと思って残っていない**のが最悪なので、逆に必ずエラーにする。
 */
router.post('/promote', async (req, res) => {
  const userId = callerId(req);
  const { session_id: sessionId, text } = req.body || {};
  if (!userId) return res.status(401).json({ error: '認証が必要です' });

  const entry = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
  if (!entry || entry.userId !== userId) {
    return res.status(403).json({ error: 'この会話では残せません' });
  }
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return res.status(400).json({ error: '残す内容がありません' });

  const server = entry.serverOf.get('send_message');
  if (!server) {
    // ★ 黙って捨てない。このルームでは送信の道具が使えない、と正直に返す
    return res.status(409).json({ error: 'このルームには残せません (送信の道具が使えません)' });
  }

  try {
    // ★ 由来が本文から読める印。ルームには普段の AI 応答も出るので、
    //   区別が付かないと後から見た人が「いつ誰が言ったのか」を追えなくなる。
    const content = `🎙 会話モードから

${body}`;
    await (server as McpServerLike).callTool('send_message', { room_id: entry.roomId, content });
    logger.info(`[voice-chat] 昇格 room=${entry.roomId} ${body.length}字 by ${userId}`);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[voice-chat] 昇格に失敗: ${message}`);
    res.status(502).json({ error: `残せませんでした: ${message}` });
  }
});

/**
 * ★ 会話の逐語は 1 週間で消す (#389、利用者判断 2026-09-05)。
 *
 * ★★ 会話モードは「組織記憶に入れないための入口」で、会話はルームに 1 件も入らない
 *   —— **書かないことで捨てている**。ところが計測ログには逐語が丸ごと残っていた。
 *   docs/08 §11 が名指しで警告していた形:
 *
 *   > 「捨てる」をどこまで本当に捨てるか。**「使い捨て」を名乗って実は残っていると、
 *   >  信頼を一度で失う。中途半端が一番悪い**
 *
 * ★ 1 週間なのは、測り直し (§7-5) には足りて、溜め込みにはならない長さだから。
 * ★ `.jsonl` 以外には触らない。同じ置き場に別のものが来ても壊さないため。
 * ★ 失敗しても投げない。掃除で会話を止めない。
 */
export const VOICE_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function pruneVoiceChatLogs(dir: string, maxAgeMs: number, now: number = Date.now()): number {
  let removed = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const full = path.join(dir, name);
      try {
        if (now - fs.statSync(full).mtimeMs <= maxAgeMs) continue;
        fs.unlinkSync(full);
        removed += 1;
      } catch (err) {
        logger.warn(`[voice-chat] 古いログを消せませんでした ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`[voice-chat] ログの掃除に失敗: ${err instanceof Error ? err.message : String(err)}`);
  }
  return removed;
}

/**
 * POST /voice-chat/log — ブラウザ側の計測を受け取る (docs/08 §12.6)。
 * ★ 成立の基準 4 項目 (§7.1) を**あとから数えられる形**で残すための口。
 *   §2.2 と同じ段分けで集計できるよう、生のイベントをそのまま JSONL に落とす。
 */
router.post('/log', (req, res) => {
  const userId = callerId(req);
  const { session_id: sessionId, events } = req.body || {};
  if (!userId) return res.status(401).json({ error: '認証が必要です' });
  if (typeof sessionId !== 'string' || !Array.isArray(events)) {
    return res.status(400).json({ error: 'session_id と events が必要です' });
  }

  try {
    const dir = path.join(config.WORKSPACE_ROOT, '_voice-chat-logs');
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      session_id: sessionId,
      user_id: userId,
      room_id: sessions.get(sessionId)?.roomId ?? null,
      received_at: new Date().toISOString(),
      events,
    });
    fs.appendFileSync(path.join(dir, `${sessionId}.jsonl`), `${line}\n`, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    // 計測が落ちても会話は止めない
    logger.warn(`[voice-chat] log 書き込み失敗: ${err instanceof Error ? err.message : String(err)}`);
    res.json({ ok: false });
  }
});

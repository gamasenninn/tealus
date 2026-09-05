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
 *   2. ★ 関数方式は**道具の説明文を毎セッション渡す**ので、増えるほど遅くなる
 *      = 成立の基準① (2 秒) を自分で削ることになる (docs/08 §7.1)
 * 試作は read 系 + 昇格用の送信だけ。増やすときは①を測り直してから。
 */
const ALLOWED_TOOLS = new Set([
  'get_messages',
  'search_messages',
  'list_rooms',
  'list_tags',
  'read_document',
  'send_message',   // 昇格 (docs/08 §1.2.2 の成立条件)
]);

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

    const serverOf = new Map<string, McpServerLike>();
    const picked: McpToolLike[] = [];
    for (const s of servers) {
      let tools: McpToolLike[];
      try {
        tools = await s.listTools();
      } catch (err) {
        logger.warn(`[voice-chat] listTools 失敗 (この MCP は道具なしで続行): ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      for (const t of tools) {
        if (!ALLOWED_TOOLS.has(t.name) || serverOf.has(t.name)) continue;
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

    logger.info(`[voice-chat] session ${sessionId.slice(0, 8)} room=${roomId} tools=${picked.length} by ${userId}`);
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

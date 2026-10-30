/**
 * 設定ファイル読み書き API
 * ダッシュボードからエージェント設定を編集するためのエンドポイント
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../lib/logger.mts';
import { getAllSettings, saveSettings, loadSettings, type AgentSettings } from '../context/settingsManager.mts';
import * as botApi from '../lib/botApi.mts';
import * as config from '../config.mts';
import { invalidateRoomMcp } from '../mcp/roomMcpManager.mts';
import { TTS_ENGINES, TTS_VOICES, resolveRoomTts } from '../lib/ttsRoom.mts';
import { inactiveAgentSettings } from '../context/settingsEffect.mts';
import { sendServerError } from '../lib/serverError.mts';
import { readRoomConfig, readRoomConfigJson, writeRoomConfig } from '../lib/roomConfigPaths.mts';
import { keepPrevious } from '../lib/keepPrevious.mts';

export const router = express.Router();

// AGENT_CONFIG_DIR / AGENT_MCP_CONFIG_PATH env で override 可能 (test isolation 用、production では unset で default)
const CONFIG_DIR = process.env.AGENT_CONFIG_DIR || path.join(import.meta.dirname, '..', '..', 'config');
const MCP_CONFIG_PATH = process.env.AGENT_MCP_CONFIG_PATH || path.join(import.meta.dirname, '..', '..', 'mcp_config.json');
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..', config.WORKSPACE_ROOT || './agent-workspaces');
const ENV_PATH = path.join(import.meta.dirname, '..', '..', '.env');

// 安全に公開する .env のキー（API Key は除外）
const SAFE_ENV_KEYS = [
  'AGENT_PORT', 'TEALUS_API_URL', 'AGENT_LIGHT_MODEL', 'AGENT_ROUTER_MODEL',
  'AGENT_WORKSPACE_ROOT', 'DEEP_TIMEOUT', 'DEEP_MAX_BUFFER',
];

/**
 * GET /config/settings — settings.json を返す
 */
router.get('/settings', (req, res) => {
  // ★ #590 今の経路で効いていない項目と理由を添える (画面がグレーアウトに使う)
  const lightBackend = config.AGENT_LIGHT_BACKEND || 'v2';
  res.json({ settings: getAllSettings(), inactive: inactiveAgentSettings(lightBackend), light_backend: lightBackend });
});

/**
 * PUT /config/settings — settings.json を書き出し
 */
router.put('/settings', (req, res) => {
  const { settings } = req.body as { settings?: AgentSettings };
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'settings オブジェクトが必要です' });
  }
  try {
    saveSettings(settings);
    res.json({ success: true });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * GET /config/mcp — mcp_config.json を返す
 */
router.get('/mcp', (req, res) => {
  try {
    if (fs.existsSync(MCP_CONFIG_PATH)) {
      const mcpConfig = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8'));
      res.json({ mcpConfig });
    } else {
      res.json({ mcpConfig: { mcpServers: {} } });
    }
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * PUT /config/mcp — mcp_config.json を書き出し
 */
router.put('/mcp', (req, res) => {
  const { mcpConfig } = req.body as { mcpConfig?: object };
  if (!mcpConfig || typeof mcpConfig !== 'object') {
    return res.status(400).json({ error: 'mcpConfig オブジェクトが必要です' });
  }
  try {
    const next = JSON.stringify(mcpConfig, null, 2) + '\n';
    keepPrevious(MCP_CONFIG_PATH, next);   // ★ 前の版を 1 つ残す (2026-10-30 小野さん判断 1)
    fs.writeFileSync(MCP_CONFIG_PATH, next);
    res.json({ success: true });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * GET /config/tts-options — ルーム設定の「読み上げエンジン・声」の選択肢 (2026-09-26)
 *
 * ★ 一覧は lib/ttsRoom.mts の 1 か所。ダッシュボードはここから受け取る。
 * ★★ 鍵は「あるか (available)」だけを返し、値は返さない。
 */
router.get('/tts-options', (req, res) => {
  const provider = config.TTS_PROVIDER;
  const keyOf: Record<string, string | undefined> = {
    aivis: process.env.AIVIS_API_KEY,
    openai: config.OPENAI_API_KEY,
    gemini: config.GOOGLE_API_KEY,
  };
  const def = resolveRoomTts(provider, null);
  res.json({
    global_provider: provider,
    // ★ 全体が browser / none のときはルームの設定は効かない (画面に出すため)
    room_override_effective: def.mode === 'server',
    default_engine: def.mode === 'server' ? def.engine : null,
    engines: TTS_ENGINES.map((e) => ({ ...e, available: Boolean(keyOf[e.id]) })),
    voices: TTS_VOICES,
  });
});

/**
 * GET /config/env — .env の安全な項目のみ返す
 */
router.get('/env', (req, res) => {
  try {
    const env: Record<string, string> = {};
    if (fs.existsSync(ENV_PATH)) {
      const content = fs.readFileSync(ENV_PATH, 'utf8');
      for (const line of content.split('\n')) {
        const match = line.match(/^([A-Z_]+)=(.*)$/);
        if (match && SAFE_ENV_KEYS.includes(match[1])) {
          env[match[1]] = match[2];
        }
      }
    }
    res.json({ env });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * GET /config/system-prompt — カスタムプロンプトを返す（なければデフォルト）
 */
router.get('/system-prompt', (req, res) => {
  const customPath = path.join(CONFIG_DIR, 'system_prompt.md');
  const defaultPath = path.join(CONFIG_DIR, 'default_system_prompt.md');
  try {
    const custom = fs.existsSync(customPath) ? fs.readFileSync(customPath, 'utf8') : '';
    const defaultPrompt = fs.existsSync(defaultPath) ? fs.readFileSync(defaultPath, 'utf8') : '';
    res.json({ custom, default: defaultPrompt, isCustom: !!custom.trim() });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * PUT /config/system-prompt — カスタムプロンプトを保存
 */
router.put('/system-prompt', (req, res) => {
  const { content } = req.body as { content?: string };
  if (content === undefined) return res.status(400).json({ error: 'content が必要です' });
  const customPath = path.join(CONFIG_DIR, 'system_prompt.md');
  try {
    if (!content.trim()) {
      // 空 → カスタムファイル削除（デフォルトに戻す）
      keepPrevious(customPath, null);   // ★ 消す前にも残す (空で保存 = 消す、なので誤って空にしても戻せる)
      if (fs.existsSync(customPath)) fs.unlinkSync(customPath);
    } else {
      keepPrevious(customPath, content);
      fs.writeFileSync(customPath, content);
    }
    res.json({ success: true });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

// === ルーム設定 API ===

/**
 * ルームのワークスペースパスを解決
 */
function resolveRoomWorkspace(roomId: string): string | null {
  const agentId = botApi.getBotUserId();
  if (!agentId) return null;
  return path.join(WORKSPACE_ROOT, agentId, roomId);
}

interface RoomApiMember {
  id: string;
  display_name?: string;
}

interface RoomApiItem {
  id: string;
  name?: string;
  type?: string;
  member_count?: number;
  members?: RoomApiMember[];
  partner_display_name?: string;
}

interface AdminRoomsResponse {
  rooms?: RoomApiItem[];
}

interface RoomSettingsFile {
  response_mode?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

interface RoomSummary extends RoomSettingsFile {
  room_id: string;
  name?: string;
  type?: string;
  member_count?: number;
}

/**
 * GET /config/rooms — 全ルームのワークスペース一覧 + 設定サマリ
 */
// ワークスペースをスキャンしてルーム一覧を返す共通関数
async function listAgentRooms(agentId: string): Promise<RoomSummary[]> {
  const agentDir = path.join(WORKSPACE_ROOT, agentId);
  if (!fs.existsSync(agentDir)) return [];

  // admin API で全ルーム情報を取得（エージェントに関係なくルーム名を解決）
  const roomInfoMap = new Map<string, { name?: string; type?: string; member_count?: number }>();
  try {
    // botApi.request は private helper で export されていない (#330 TS 移行時点の
    // botApi.mts 確認済み)。元実装 (routes/settings.js) も同様に botApi.request を
    // 呼んでおり、常に例外→下の Bot API フォールバックに落ちる潜在挙動だった。
    // これを変えずに保持するため、存在しない前提でキャストして呼び出す。
    const request = (botApi as unknown as {
      request?: (method: string, path: string) => Promise<AdminRoomsResponse>;
    }).request;
    const allRooms = await request!('GET', '/admin/rooms');
    const roomList = allRooms.rooms || [];
    for (const r of roomList) {
      let name = r.name;
      if (r.type === 'direct' && r.members) {
        // DM: エージェント以外のメンバー名を表示
        const other = r.members.find((m: RoomApiMember) => m.id !== agentId);
        name = other?.display_name || 'DM';
      }
      roomInfoMap.set(r.id, { name, type: r.type, member_count: r.member_count });
    }
  } catch {
    // フォールバック: Bot API
    try {
      const apiRooms = (await botApi.getRooms()) as AdminRoomsResponse | RoomApiItem[];
      const roomList: RoomApiItem[] = Array.isArray(apiRooms) ? apiRooms : (apiRooms.rooms || []);
      for (const r of roomList) {
        roomInfoMap.set(r.id, { name: r.name || r.partner_display_name || 'DM', type: r.type, member_count: r.member_count });
      }
    } catch { /* ignore */ }
  }

  const rooms: RoomSummary[] = [];
  for (const roomId of fs.readdirSync(agentDir)) {
    const roomDir = path.join(agentDir, roomId);
    if (!fs.statSync(roomDir).isDirectory()) continue;
    // ★ G-1 設定の置き場は workspace の外 (_room-configs)。ルームの一覧は workspace のフォルダで数える (今までどおり)
    const settings: RoomSettingsFile = readRoomConfigJson<RoomSettingsFile>(roomDir, 'room_settings.json')
      ?? { response_mode: 'auto', enabled: true };
    const info = roomInfoMap.get(roomId);
    if (!info) continue; // 退出済みルームはスキップ
    rooms.push({ room_id: roomId, name: info.name, type: info.type, member_count: info.member_count, ...settings });
  }
  return rooms;
}

/**
 * GET /config/rooms — デフォルトエージェントのルーム一覧（後方互換）
 */
router.get('/rooms', async (req, res) => {
  try {
    const agentId = botApi.getBotUserId();
    if (!agentId) return res.json({ rooms: [] });
    const rooms = await listAgentRooms(agentId);
    res.json({ rooms });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * GET /config/rooms/:agentId — 指定エージェントのルーム一覧
 */
/**
 * GET /config/agent-room-counts — エージェントごとのルーム数 (2026-09-26)
 *
 * ★ ダッシュボードのエージェント一覧で「ルームを持っているか」を一目で分かるようにする
 *   (ルームに属しているのはアシスタントだけで、他は押しても空の一覧になっていた)。
 * ★★ 数え方は GET /config/rooms/:agentId と同じ listAgentRooms (退出済みは数えない) —— 一覧と数を食い違わせない。
 * ★ `_` で始まるフォルダ (_voice-chat-logs 等) はエージェントではないので数えない。
 */
router.get('/agent-room-counts', async (req, res) => {
  try {
    const counts: Record<string, number> = {};
    if (fs.existsSync(WORKSPACE_ROOT)) {
      for (const name of fs.readdirSync(WORKSPACE_ROOT)) {
        if (name.startsWith('_')) continue;
        if (!fs.statSync(path.join(WORKSPACE_ROOT, name)).isDirectory()) continue;
        counts[name] = (await listAgentRooms(name)).length;
      }
    }
    res.json({ counts });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

router.get('/rooms/:agentId', async (req, res) => {
  try {
    const rooms = await listAgentRooms(req.params.agentId);
    res.json({ rooms });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

// ★ G-1 (2026-10-27) ルームの設定 4 つ (room_settings.json / CLAUDE.md / light_prompt.md / mcp_config.json) の置き場は
//   workspace の外 `<WORKSPACE_ROOT>/_room-configs/<agentId>/<roomId>/` (lib/roomConfigPaths.mts)。
//   workspace は AI が書ける場所 (filesystem MCP の root・Deep の cwd) なので、そこに置くと注入された AI が
//   応答モードや道具や指示を書き換えて持ち越せた。ここでは workspace のパスを「置き場を引く鍵」としてだけ使う。

/**
 * GET /config/room/:roomId/settings — room_settings.json
 */
router.get('/room/:roomId/settings', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  try {
    const text = readRoomConfig(ws, 'room_settings.json');
    if (text !== null) {
      res.json({ settings: JSON.parse(text) });
    } else {
      res.json({ settings: { response_mode: 'auto', enabled: true } });
    }
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * PUT /config/room/:roomId/settings — room_settings.json 書き出し
 */
router.put('/room/:roomId/settings', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { settings } = req.body as { settings?: RoomSettingsFile };
  if (!settings) return res.status(400).json({ error: 'settings が必要です' });
  try {
    if (!fs.existsSync(ws)) fs.mkdirSync(ws, { recursive: true });   // ルームの一覧は workspace のフォルダで数える
    writeRoomConfig(ws, 'room_settings.json', JSON.stringify(settings, null, 2) + '\n');
    res.json({ success: true });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * GET /config/room/:roomId/claude-md — CLAUDE.md
 */
router.get('/room/:roomId/claude-md', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  try {
    res.json({ content: readRoomConfig(ws, 'CLAUDE.md') ?? '' });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * PUT /config/room/:roomId/claude-md — CLAUDE.md 書き出し
 */
router.put('/room/:roomId/claude-md', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { content } = req.body as { content?: string };
  if (content === undefined) return res.status(400).json({ error: 'content が必要です' });
  try {
    if (!fs.existsSync(ws)) fs.mkdirSync(ws, { recursive: true });
    writeRoomConfig(ws, 'CLAUDE.md', content);
    res.json({ success: true });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * GET /config/room/:roomId/light-prompt — light_prompt.md
 */
router.get('/room/:roomId/light-prompt', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  try {
    res.json({ content: readRoomConfig(ws, 'light_prompt.md') ?? '' });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * PUT /config/room/:roomId/light-prompt — light_prompt.md 書き出し
 */
router.put('/room/:roomId/light-prompt', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { content } = req.body as { content?: string };
  if (content === undefined) return res.status(400).json({ error: 'content が必要です' });
  try {
    if (!fs.existsSync(ws)) fs.mkdirSync(ws, { recursive: true });
    writeRoomConfig(ws, 'light_prompt.md', content);
    res.json({ success: true });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * GET /config/room/:roomId/mcp — ルーム固有 mcp_config.json
 */
router.get('/room/:roomId/mcp', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  try {
    const text = readRoomConfig(ws, 'mcp_config.json');
    if (text !== null) {
      res.json({ mcpConfig: JSON.parse(text) });
    } else {
      res.json({ mcpConfig: null });
    }
  } catch (err) {
    sendServerError(req, res, err);
  }
});

/**
 * PUT /config/room/:roomId/mcp — ルーム固有 mcp_config.json 書き出し
 */
router.put('/room/:roomId/mcp', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { mcpConfig } = req.body as { mcpConfig?: object };
  if (!mcpConfig) return res.status(400).json({ error: 'mcpConfig が必要です' });
  try {
    if (!fs.existsSync(ws)) fs.mkdirSync(ws, { recursive: true });
    writeRoomConfig(ws, 'mcp_config.json', JSON.stringify(mcpConfig, null, 2) + '\n');
    // MCP キャッシュを即時無効化（次回メッセージで新設定で再接続）
    const agentId = botApi.getBotUserId();
    if (agentId) {
      invalidateRoomMcp(agentId, req.params.roomId).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

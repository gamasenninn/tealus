/**
 * 設定ファイル読み書き API
 * ダッシュボードからエージェント設定を編集するためのエンドポイント
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const { getAllSettings, saveSettings, loadSettings } = require('../context/settingsManager');
const botApi = require('../lib/botApi');
const config = require('../config');
const { invalidateRoomMcp } = require('../mcp/roomMcpManager');

const router = express.Router();

const MCP_CONFIG_PATH = path.join(__dirname, '..', '..', 'mcp_config.json');
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', config.WORKSPACE_ROOT || './agent-workspaces');
const ENV_PATH = path.join(__dirname, '..', '..', '.env');

// 安全に公開する .env のキー（API Key は除外）
const SAFE_ENV_KEYS = [
  'AGENT_PORT', 'TEALUS_API_URL', 'AGENT_LIGHT_MODEL', 'AGENT_ROUTER_MODEL',
  'AGENT_WORKSPACE_ROOT', 'DEEP_TIMEOUT', 'DEEP_MAX_BUFFER', 'LIGHT_CONTEXT_MESSAGES',
];

/**
 * GET /config/settings — settings.json を返す
 */
router.get('/settings', (req, res) => {
  res.json({ settings: getAllSettings() });
});

/**
 * PUT /config/settings — settings.json を書き出し
 */
router.put('/settings', (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'settings オブジェクトが必要です' });
  }
  try {
    saveSettings(settings);
    res.json({ success: true });
  } catch (err) {
    logger.error(`Save settings error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /config/mcp — mcp_config.json を返す
 */
router.get('/mcp', (req, res) => {
  try {
    if (fs.existsSync(MCP_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8'));
      res.json({ mcpConfig: config });
    } else {
      res.json({ mcpConfig: { mcpServers: {} } });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /config/mcp — mcp_config.json を書き出し
 */
router.put('/mcp', (req, res) => {
  const { mcpConfig } = req.body;
  if (!mcpConfig || typeof mcpConfig !== 'object') {
    return res.status(400).json({ error: 'mcpConfig オブジェクトが必要です' });
  }
  try {
    fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2) + '\n');
    res.json({ success: true });
  } catch (err) {
    logger.error(`Save MCP config error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /config/env — .env の安全な項目のみ返す
 */
router.get('/env', (req, res) => {
  try {
    const env = {};
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
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /config/system-prompt — カスタムプロンプトを返す（なければデフォルト）
 */
router.get('/system-prompt', (req, res) => {
  const configDir = path.join(__dirname, '..', '..', 'config');
  const customPath = path.join(configDir, 'system_prompt.md');
  const defaultPath = path.join(configDir, 'default_system_prompt.md');
  try {
    const custom = fs.existsSync(customPath) ? fs.readFileSync(customPath, 'utf8') : '';
    const defaultPrompt = fs.existsSync(defaultPath) ? fs.readFileSync(defaultPath, 'utf8') : '';
    res.json({ custom, default: defaultPrompt, isCustom: !!custom.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /config/system-prompt — カスタムプロンプトを保存
 */
router.put('/system-prompt', (req, res) => {
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'content が必要です' });
  const configDir = path.join(__dirname, '..', '..', 'config');
  const customPath = path.join(configDir, 'system_prompt.md');
  try {
    if (!content.trim()) {
      // 空 → カスタムファイル削除（デフォルトに戻す）
      if (fs.existsSync(customPath)) fs.unlinkSync(customPath);
    } else {
      fs.writeFileSync(customPath, content);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ルーム設定 API ===

/**
 * ルームのワークスペースパスを解決
 */
function resolveRoomWorkspace(roomId) {
  const agentId = botApi.getBotUserId();
  if (!agentId) return null;
  return path.join(WORKSPACE_ROOT, agentId, roomId);
}

/**
 * GET /config/rooms — 全ルームのワークスペース一覧 + 設定サマリ
 */
router.get('/rooms', (req, res) => {
  try {
    const agentId = botApi.getBotUserId();
    if (!agentId) return res.json({ rooms: [] });
    const agentDir = path.join(WORKSPACE_ROOT, agentId);
    if (!fs.existsSync(agentDir)) return res.json({ rooms: [] });

    const rooms = [];
    for (const roomId of fs.readdirSync(agentDir)) {
      const roomDir = path.join(agentDir, roomId);
      if (!fs.statSync(roomDir).isDirectory()) continue;
      const settingsPath = path.join(roomDir, 'room_settings.json');
      let settings = { response_mode: 'auto', enabled: true };
      if (fs.existsSync(settingsPath)) {
        try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
      }
      rooms.push({ room_id: roomId, ...settings });
    }
    res.json({ rooms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /config/room/:roomId/settings — room_settings.json
 */
router.get('/room/:roomId/settings', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const filePath = path.join(ws, 'room_settings.json');
  try {
    if (fs.existsSync(filePath)) {
      res.json({ settings: JSON.parse(fs.readFileSync(filePath, 'utf8')) });
    } else {
      res.json({ settings: { response_mode: 'auto', enabled: true } });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /config/room/:roomId/settings — room_settings.json 書き出し
 */
router.put('/room/:roomId/settings', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { settings } = req.body;
  if (!settings) return res.status(400).json({ error: 'settings が必要です' });
  try {
    if (!fs.existsSync(ws)) fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'room_settings.json'), JSON.stringify(settings, null, 2) + '\n');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /config/room/:roomId/claude-md — CLAUDE.md
 */
router.get('/room/:roomId/claude-md', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const filePath = path.join(ws, 'CLAUDE.md');
  try {
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /config/room/:roomId/claude-md — CLAUDE.md 書き出し
 */
router.put('/room/:roomId/claude-md', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'content が必要です' });
  try {
    if (!fs.existsSync(ws)) fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'CLAUDE.md'), content);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /config/room/:roomId/light-prompt — light_prompt.md
 */
router.get('/room/:roomId/light-prompt', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const filePath = path.join(ws, 'light_prompt.md');
  try {
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /config/room/:roomId/light-prompt — light_prompt.md 書き出し
 */
router.put('/room/:roomId/light-prompt', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'content が必要です' });
  try {
    if (!fs.existsSync(ws)) fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'light_prompt.md'), content);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /config/room/:roomId/mcp — ルーム固有 mcp_config.json
 */
router.get('/room/:roomId/mcp', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const filePath = path.join(ws, 'mcp_config.json');
  try {
    if (fs.existsSync(filePath)) {
      res.json({ mcpConfig: JSON.parse(fs.readFileSync(filePath, 'utf8')) });
    } else {
      res.json({ mcpConfig: null });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /config/room/:roomId/mcp — ルーム固有 mcp_config.json 書き出し
 */
router.put('/room/:roomId/mcp', (req, res) => {
  const ws = resolveRoomWorkspace(req.params.roomId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { mcpConfig } = req.body;
  if (!mcpConfig) return res.status(400).json({ error: 'mcpConfig が必要です' });
  try {
    if (!fs.existsSync(ws)) fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'mcp_config.json'), JSON.stringify(mcpConfig, null, 2) + '\n');
    // MCP キャッシュを即時無効化（次回メッセージで新設定で再接続）
    const agentId = botApi.getBotUserId();
    if (agentId) {
      invalidateRoomMcp(agentId, req.params.roomId).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

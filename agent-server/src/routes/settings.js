/**
 * 設定ファイル読み書き API
 * ダッシュボードからエージェント設定を編集するためのエンドポイント
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const { getAllSettings, saveSettings, loadSettings } = require('../context/settingsManager');

const router = express.Router();

const MCP_CONFIG_PATH = path.join(__dirname, '..', '..', 'mcp_config.json');
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

module.exports = router;

/**
 * Express app 定義（サーバー起動は index.js で行う）
 */
const express = require('express');
const cors = require('cors');
const webhookRoutes = require('./webhook/routes');
const settingsRoutes = require('./routes/settings');
const logsRoutes = require('./routes/logs');

const app = express();
app.use(express.json());
app.use(cors());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tealus-agent-server',
    timestamp: new Date().toISOString(),
  });
});

// Webhook endpoint
app.use('/webhook', webhookRoutes);

// Config API（ダッシュボードから設定ファイルを読み書き）
app.use('/config', settingsRoutes);

// Logs API（ダッシュボードからログ閲覧）
app.use('/logs', logsRoutes);

module.exports = { app };

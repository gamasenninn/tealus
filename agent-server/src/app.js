/**
 * Express app 定義（サーバー起動は index.js で行う）
 */
const express = require('express');
const cors = require('cors');
const webhookRoutes = require('./webhook/routes');
const settingsRoutes = require('./routes/settings');
const logsRoutes = require('./routes/logs');
const { authenticate } = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use(cors());

// Health check（認証不要）
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tealus-agent-server',
    timestamp: new Date().toISOString(),
  });
});

// Webhook endpoint（認証不要、HMAC署名で別途検証）
app.use('/webhook', webhookRoutes);

// Config API（認証必要）
app.use('/config', authenticate, settingsRoutes);

// Logs API（認証必要）
app.use('/logs', authenticate, logsRoutes);

module.exports = { app };

/**
 * Express app 定義（サーバー起動は index.js で行う）
 */
const express = require('express');
const webhookRoutes = require('./webhook/routes');

const app = express();
app.use(express.json());

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

module.exports = { app };

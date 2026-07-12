/**
 * Express app 定義（サーバー起動は index.mts で行う）
 */
// config を最初に import (dotenv.config() を他 module 評価より先に走らせる)
import * as config from './config.mts';
import express from 'express';
import cors from 'cors';
import { router as webhookRoutes } from './webhook/routes.mts';
import { router as settingsRoutes } from './routes/settings.mts';
import { router as logsRoutes } from './routes/logs.mts';
import { router as ttsRoutes } from './routes/tts.mts';
import { router as agentRoutes } from './routes/agent.mts';
import { authenticate } from './middleware/auth.mts';

export const app = express();
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

// 公開 config（認証不要）— server の /api/config から呼ばれ、resolved な TTS provider を返す。
// client は build 時 env を持たない設計なので、ここが TTS_PROVIDER の真の情報源。
app.get('/public-config', (req, res) => {
  res.json({ tts_provider: config.TTS_PROVIDER });
});

// Webhook endpoint（認証不要、HMAC署名で別途検証）
app.use('/webhook', webhookRoutes);

// Config API（認証必要）
app.use('/config', authenticate, settingsRoutes);

// Logs API（認証必要）
app.use('/logs', authenticate, logsRoutes);

// TTS API（認証必要）— #155 個人読み上げ用
app.use('/tts', authenticate, ttsRoutes);

// Agent control API（認証必要）— #250 Deep agent cancel
app.use('/agent', authenticate, agentRoutes);

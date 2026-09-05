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
import { router as ccQueueRoutes } from './routes/ccQueue.mts';
import { router as voiceChatRoutes } from './routes/voiceChat.mts';
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

// #405 Realtime 音声会話（認証必要）— docs/08 §12。使い捨てトークンの発行 / 道具の実行 / 計測。
// 認証は JWT のみなので、route 側でさらに本体 /api/rooms/:id を引いて
// 「参加しているか」と「そのルームで開けてよいか」の両方を確認する。
app.use('/voice-chat', authenticate, voiceChatRoutes);

// cc-queue ストリーム（認証必要）— #214 CC セッションを別マシンで動かすための復路。
// 認証は署名検証のみなので、route 側でさらに本体 /api/rooms を引いて参加ルームに絞る。
app.use('/cc-queue', authenticate, ccQueueRoutes);

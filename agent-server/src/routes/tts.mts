/**
 * TTS (Text-to-Speech) REST endpoint
 * For local playback (personal read-aloud), not broadcast.
 * Uses existing ttsSpeak synthesize() and room TTS model settings.
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { synthesize, preprocessText } from '../lib/ttsSpeak.mts';
import * as botApi from '../lib/botApi.mts';
import { logger } from '../lib/logger.mts';

export const router = express.Router();

const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT || path.join(import.meta.dirname, '../../agent-workspaces');

interface RoomSettings {
  tts_model_uuid?: string;
  [key: string]: unknown;
}

/**
 * Get room's TTS model UUID from room_settings.json
 * Returns undefined if not configured (caller should fall back to default).
 */
function getRoomTtsModel(roomId: string): string | undefined {
  try {
    const agentId = botApi.getBotUserId();
    if (!agentId) return undefined;
    const settingsPath = path.join(WORKSPACE_ROOT, agentId, roomId, 'room_settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as RoomSettings;
    return settings.tts_model_uuid || undefined;
  } catch {
    return undefined;
  }
}

/**
 * POST /tts/synthesize
 * body: { text, room_id?, model_uuid? }
 * Returns audio/wav binary.
 *
 * Model UUID resolution order:
 *   1. explicit model_uuid in body
 *   2. room's tts_model_uuid (if room_id provided)
 *   3. default from env (AIVIS_MODEL_UUID)
 */
router.post('/synthesize', async (req, res) => {
  const { text, room_id, model_uuid } = req.body as { text?: string; room_id?: string; model_uuid?: string };

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  // Resolve model UUID
  let resolvedModel: string | undefined = model_uuid || undefined;
  if (!resolvedModel && room_id) {
    resolvedModel = getRoomTtsModel(room_id);
  }
  // synthesize() itself falls back to env default when resolvedModel is undefined

  // Markdown 除去・URL 変換 (= #155 共通)。
  // truncate: false (= 個人 button TTS は user 明示 click、全文読み上げが期待される、
  // 6/13 14:56 業務メモ user voice 確定)
  const cleaned = preprocessText(text, { truncate: false });
  if (!cleaned) {
    return res.status(400).json({ error: 'text is empty after preprocessing' });
  }

  try {
    const wavBuf = await synthesize(cleaned, resolvedModel);
    res.type('audio/wav').send(wavBuf);
  } catch (err) {
    logger.error(`[TTS] synthesize error: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: 'TTS synthesis failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * TTS (Text-to-Speech) REST endpoint
 * For local playback (personal read-aloud), not broadcast.
 * Uses existing ttsSpeak synthesize() and room TTS model settings.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { synthesize, preprocessText } = require('../lib/ttsSpeak');
const botApi = require('../lib/botApi');
const logger = require('../lib/logger');

const router = express.Router();

const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT || path.join(__dirname, '../../agent-workspaces');

/**
 * Get room's TTS model UUID from room_settings.json
 * Returns null if not configured (caller should fall back to default).
 */
function getRoomTtsModel(roomId) {
  try {
    const agentId = botApi.getBotUserId();
    if (!agentId) return null;
    const settingsPath = path.join(WORKSPACE_ROOT, agentId, roomId, 'room_settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return settings.tts_model_uuid || null;
  } catch {
    return null;
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
  const { text, room_id, model_uuid } = req.body;

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  // Resolve model UUID
  let resolvedModel = model_uuid || null;
  if (!resolvedModel && room_id) {
    resolvedModel = getRoomTtsModel(room_id);
  }
  // synthesize() itself falls back to env default when resolvedModel is null

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
    logger.error(`[TTS] synthesize error: ${err.message}`);
    res.status(500).json({ error: 'TTS synthesis failed', detail: err.message });
  }
});

module.exports = router;

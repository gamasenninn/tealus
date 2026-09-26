/**
 * TTS (Text-to-Speech) REST endpoint
 * For local playback (personal read-aloud), not broadcast.
 * Uses existing ttsSpeak synthesize() and room TTS model settings.
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { synthesizeByEngine, preprocessText, engineForProvider } from '../lib/ttsSpeak.mts';
import * as config from '../config.mts';
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
    // ★ #444 段 2: 分岐は synthesizeByEngine に集約されている (★★ ここで 2 度目を書かない)。
    //   ★★★ openai のときは #446 の読み当ても そちらで行われる —— ★ 手動ボタンでも 鹿沼 が カヌマ になる。
    const engine = engineForProvider(config.TTS_PROVIDER);  // ★ 対応は ttsSpeak の 1 か所 (2026-09-26)
    const { buffer, contentType } = await synthesizeByEngine(engine, cleaned, resolvedModel);
    // ★ audio/wav 固定をやめる。★★ 合成結果の Content-Type をそのまま返す
    res.type(contentType).send(buffer);
  } catch (err) {
    logger.error(`[TTS] synthesize error: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: 'TTS synthesis failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

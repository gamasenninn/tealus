/**
 * TTS (Text-to-Speech) REST endpoint
 * For local playback (personal read-aloud), not broadcast.
 * Uses existing ttsSpeak synthesize() and room TTS model settings.
 */
import express from 'express';
import { synthesizeByEngine, preprocessText, engineForProvider } from '../lib/ttsSpeak.mts';
import { resolveRoomTts, readRoomTtsSettings } from '../lib/ttsRoom.mts';
import * as config from '../config.mts';
import { logger } from '../lib/logger.mts';

export const router = express.Router();

// ★ 2026-09-26: ルーム設定の読み込みは ttsRoom.readRoomTtsSettings の 1 か所に寄せた
//   (それまでこのファイルと ttsSpeak.mts に同じ関数が 2 つあった)。

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

  // ★ 2026-09-26: ルームの設定 (エンジン・声) に従う。自動の読み上げ (speakMessage) と同じ決め方
  //   全体が browser / none のときは端末が Web Speech で読むのでここへは来ない想定 → 全体のエンジンのまま
  const r = resolveRoomTts(config.TTS_PROVIDER, readRoomTtsSettings(room_id));
  const engine = r.mode === 'server' ? r.engine : engineForProvider(config.TTS_PROVIDER);
  const voice = r.mode === 'server' ? r.voice : undefined;
  // Aivis の声: 明示 (model_uuid) > ルーム > 既定 (synthesize() が env にフォールバック)
  const resolvedModel: string | undefined = model_uuid || (r.mode === 'server' ? r.modelUuid : undefined);

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
    const { buffer, contentType } = await synthesizeByEngine(engine, cleaned, resolvedModel, voice);
    // ★ audio/wav 固定をやめる。★★ 合成結果の Content-Type をそのまま返す
    res.type(contentType).send(buffer);
  } catch (err) {
    logger.error(`[TTS] synthesize error: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: 'TTS synthesis failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

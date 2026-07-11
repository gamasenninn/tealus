import { logger } from '../utils/logger.mts';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import OpenAI from 'openai';
import { pool } from '../db/pool.mts';
import { formatTranscription } from './formatting.mts';
import { loadGuideline, buildWhisperPrompt, buildGlossary, isWhisperPromptHallucination, getTranscriptionMode } from './transcriptionConfig.mts';
import { transcribeAudio } from './sttBackend.mts';
import { fireWebhooks } from './webhook.mts';
import type { Server } from 'socket.io';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// #284 (2026-05-25): default を gpt-4o-mini-transcribe に切替。
// 理由: gpt-4o-transcribe は無音/ノイズに「業務無線文を組み立てる幻覚」(= prompt-conditioned
// content hallucination) を出し、既存フィルタ isWhisperPromptHallucination() をすり抜けていた。
// gpt-4o-mini-transcribe は同条件で「prompt をそのまま返す」(= prompt echo) ため、既存フィルタが
// 捕捉して空化できる。3 モデル比較実験 (捏造6件+正常15件) で:
//   - 捏造6/6 が既存フィルタで空化、正常15/15 は誤って空化されず文字起こし継続
//   - トレードオフ: 固有名詞の崩れ方が変わる (mini はカナ/別字になりやすい)、organon 名寄せ+辞書 alias でカバー
// env WHISPER_MODEL で whisper-1 / gpt-4o-transcribe にも切替可能。
// (旧 #217: gpt-4o-transcribe を default 採用していた、whisper-1 比 hallucination 軽減目的)
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'gpt-4o-mini-transcribe';
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(import.meta.dirname, '../../../media');

/** messages テーブルの sender 参照行 */
interface SenderRow {
  sender_id: string;
}

export interface TranscribeMessageOptions {
  /** Socket.IO instance (null で emit 抑制、Bot endpoint 用) */
  io?: Server | null;
  roomId?: string | null;
  /** voice_transcriptions の対象 version (#216 retranscribe 用、default=1 で初回 upload と互換) */
  version?: number;
  /** video 入力なら ffmpeg -vn で audio 抽出を強制 */
  isVideo?: boolean;
  /** webhook payload の type ('voice' | 'video' | 'audio') */
  messageType?: string;
}

/**
 * Transcribe a media message (voice / video / audio) using OpenAI Whisper API
 *
 * Video の場合は ffmpeg -vn で audio 抽出 (16kHz mono opus 24k) してから Whisper に送る。
 * Whisper API の 25MB 上限内に大半の動画を収められる。
 *
 * @param messageId
 * @param filePath - MEDIA_ROOT 相対 path
 * @param options
 */
export async function transcribeMessage(
  messageId: string,
  filePath: string,
  options: TranscribeMessageOptions = {},
): Promise<string | null> {
  const {
    io = null,
    roomId = null,
    version = 1,
    isVideo = false,
    messageType = 'voice',
  } = options;
  const fullPath = path.join(MEDIA_ROOT, filePath);
  let tempPath: string | null = null;

  try {
    // Update status to transcribing
    await pool.query(
      `UPDATE voice_transcriptions SET status = 'transcribing' WHERE message_id = $1 AND version = $2`,
      [messageId, version]
    );

    // Notify clients (io が null の場合 emit skip = Bot endpoint 経由など headless 経路)
    if (io && roomId) {
      io.to(roomId).emit('voice:status', { message_id: messageId, status: 'transcribing' });
    }

    let inputPath = fullPath;
    let ext: string;

    if (isVideo) {
      // Video: ffmpeg -vn で audio 抽出 (Whisper API 25MB 上限対策)
      // mp3 VBR -q:a 4 ≈ 128kbps、1 時間で ~58MB だが Whisper API は最大 25MB なので
      // ~20 分動画まで対応。長尺は将来 chunk 分割で対応 (out of scope for Phase 1)。
      // codec=mp3 で Windows ffmpeg 標準ビルド互換 (libopus は build-dependent)
      tempPath = path.join(path.dirname(fullPath), `tealus-stt-${messageId}-v${version}.mp3`);
      try {
        execSync(
          `ffmpeg -i "${fullPath}" -y -vn -ar 16000 -ac 1 -q:a 4 "${tempPath}"`,
          { stdio: ['ignore', 'pipe', 'pipe'] }  // stderr 捕捉 (失敗時の debug 用)
        );
        inputPath = tempPath;
        ext = 'mp3';
        const audioSize = fs.statSync(tempPath).size;
        logger.info(`[transcribe] video audio extracted: ${path.basename(tempPath)} (${audioSize} bytes)`);
        if (audioSize > 25 * 1024 * 1024) {
          throw new Error(`Extracted audio (${(audioSize / 1024 / 1024).toFixed(1)}MB) exceeds Whisper API 25MB limit. Video too long, chunk split needed (future work).`);
        }
      } catch (e) {
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        tempPath = null;
        const message = e instanceof Error ? e.message : String(e);
        const stderrRaw = (e as { stderr?: Buffer | string }).stderr;
        const stderr = stderrRaw ? stderrRaw.toString() : '';
        const stderrTail = stderr ? `\nffmpeg stderr (last 500 chars): ${stderr.slice(-500)}` : '';
        throw new Error(`ffmpeg video → audio extraction failed: ${message}${stderrTail}`);
      }
    } else {
      // Voice / Audio: detect format, fallback to mp3 conversion if unknown
      // file-type は ESM 専用 package のため動的 import を維持 (Jest の CJS transform で静的 import が壊れる)
      const { fileTypeFromFile } = await import('file-type');
      const fileInfo = await fileTypeFromFile(fullPath);
      ext = fileInfo ? fileInfo.ext : path.extname(fullPath).replace('.', '') || 'webm';
      const whisperFormats = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'];
      if (!whisperFormats.includes(ext)) ext = 'webm';

      if (!fileInfo) {
        tempPath = fullPath + '.converted.mp3';
        try {
          execSync(`ffmpeg -i "${fullPath}" -y -q:a 2 "${tempPath}" 2>/dev/null`);
          inputPath = tempPath;
          ext = 'mp3';
        } catch (e) {
          if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          tempPath = null;
        }
      }
    }

    // 音声 -> raw text。★ 2 軸を直交させる (Day48):
    //   軸1 補正ステージ = TRANSCRIPTION_MODE: legacy(vocab-inject + 現行整形、出力完全同一=後方互換)
    //                                         / organon(vocab-inject 無し + organon 補正段)
    //   軸2 STT エンジン = STT_BACKEND: openai(Whisper、既定・GPU不要) / local(Qwen) / 将来の別エンジン
    // → organon 補正段は STT エンジンに依存せず効く (Exp9: Whisper生 + organon補正 = legacy比 +3)。
    //   Qwen は「訂正可能な誤り方」で更に上を取る品質アップグレード (Exp6)、GPU があれば STT_BACKEND=local。
    //   organon は「音響stageのbias」でなく「補正stageの知識源」で効かせるので vocab prompt / glossary は渡さない。
    const guideline = loadGuideline();
    const mode = getTranscriptionMode();
    const isOrganon = mode === 'organon';
    const whisperPrompt = isOrganon ? null : buildWhisperPrompt(guideline, WHISPER_MODEL);
    let rawText = await transcribeAudio({
      inputPath,
      ext,
      whisperPrompt,
      model: WHISPER_MODEL,
      glossary: isOrganon ? '' : buildGlossary(guideline),
      // backend は指定しない = 両モードとも STT_BACKEND env を尊重 (軸2 を独立させる)。
      openaiClient: openai,
    });
    const trimmedRaw = rawText.trim();

    // Bug 1 fix: Whisper prompt hallucination 検出 (#269 follow-up、5/12 user 発見)
    // 無音 / ノイズ / 短すぎる発話で Whisper が prompt を echo して返す既知挙動。
    // raw_text が prompt 自体 / 冒頭部分と一致なら effective empty として扱う。
    if (isWhisperPromptHallucination(trimmedRaw, whisperPrompt)) {
      logger.info(`[transcribe] Whisper prompt hallucination detected: raw_text matched prompt for message ${messageId} (raw="${trimmedRaw.slice(0, 50)}...")`);
      rawText = '';
    }

    // Save raw_text (effective、hallucination の場合は空)
    await pool.query(
      `UPDATE voice_transcriptions SET raw_text = $1 WHERE message_id = $2 AND version = $3`,
      [rawText, messageId, version]
    );

    // Notify clients with raw text while formatting continues
    if (io && roomId) {
      io.to(roomId).emit('voice:transcription', {
        message_id: messageId,
        status: 'formatting',
        raw_text: rawText,
      });
    }

    // Cleanup temp file
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    tempPath = null;

    // Bug 2 fix: 短い raw_text の AI 整形 skip (#269 follow-up、5/12 user 発見)
    // AI 整形 (gpt-4o-mini) が短い / 断片的な raw_text を「意味なし」と判断して
    // 空文字を返してしまう挙動が観測された。例: "松さん、松です。" → ""
    // 短い raw_text は raw_text そのまま formatted_text として採用、AI 整形 skip。
    const MIN_FORMATTING_LENGTH = 10;
    if (!rawText) {
      // hallucination または genuinely empty → status='done', formatted_text=''
      await pool.query(
        `UPDATE voice_transcriptions SET status = 'done', formatted_text = '' WHERE message_id = $1 AND version = $2`,
        [messageId, version]
      );
      if (io && roomId) {
        io.to(roomId).emit('voice:transcription', {
          message_id: messageId, status: 'done',
          raw_text: '', formatted_text: '', version,
        });
      }
    } else if (rawText.length < MIN_FORMATTING_LENGTH) {
      // 短い: AI 整形 skip、raw_text を formatted_text に採用
      logger.info(`[transcribe] short raw_text (${rawText.length} chars), skipping AI formatting for message ${messageId}: "${rawText}"`);
      await pool.query(
        `UPDATE voice_transcriptions SET status = 'done', formatted_text = $1 WHERE message_id = $2 AND version = $3`,
        [rawText, messageId, version]
      );
      if (io && roomId) {
        io.to(roomId).emit('voice:transcription', {
          message_id: messageId, status: 'done',
          raw_text: rawText, formatted_text: rawText, version,
        });
      }
      // Webhook (roomId なしなら fire skip)
      if (roomId) {
        const msgRes = await pool.query<SenderRow>('SELECT sender_id FROM messages WHERE id = $1', [messageId]);
        fireWebhooks('voice.transcription_completed', roomId, {
          room: { id: roomId },
          message: { id: messageId, type: messageType, sender: { id: msgRes.rows[0]?.sender_id } },
          transcription: { raw_text: rawText, formatted_text: rawText },
        });
      }
    } else {
      // 通常: AI formatting (mode を渡す: organon なら organon 補正段、legacy なら現行整形)
      await formatTranscription(messageId, rawText, io, roomId, version, messageType, mode);
    }

    return rawText;
  } catch (err) {
    logger.error('Transcription error:', err);
    // Cleanup temp file on error
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

    await pool.query(
      `UPDATE voice_transcriptions SET status = 'error' WHERE message_id = $1 AND version = $2`,
      [messageId, version]
    );

    if (io && roomId) {
      io.to(roomId).emit('voice:status', { message_id: messageId, status: 'error' });
    }

    return null;
  }
}

/**
 * Legacy alias for transcribeMessage (voice 専用 signature 互換、既存 call site 用)
 * 新規 caller は transcribeMessage を直接使うこと。
 */
export async function transcribeVoiceMessage(
  messageId: string,
  filePath: string,
  io: Server | null | undefined,
  roomId: string | null,
  version: number = 1,
): Promise<string | null> {
  return transcribeMessage(messageId, filePath, { io, roomId, version, isVideo: false, messageType: 'voice' });
}

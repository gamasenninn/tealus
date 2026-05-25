const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const pool = require('../db/pool');
const { formatTranscription } = require('./formatting');
const { loadGuideline, buildWhisperPrompt, isWhisperPromptHallucination } = require('./transcriptionConfig');

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
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(__dirname, '../../../media');

/**
 * Transcribe a media message (voice / video / audio) using OpenAI Whisper API
 *
 * Video の場合は ffmpeg -vn で audio 抽出 (16kHz mono opus 24k) してから Whisper に送る。
 * Whisper API の 25MB 上限内に大半の動画を収められる。
 *
 * @param {string} messageId
 * @param {string} filePath - MEDIA_ROOT 相対 path
 * @param {object} [options]
 * @param {object} [options.io] - Socket.IO instance (null で emit 抑制、Bot endpoint 用)
 * @param {string} [options.roomId]
 * @param {number} [options.version=1] - voice_transcriptions の対象 version (#216 retranscribe 用、default=1 で初回 upload と互換)
 * @param {boolean} [options.isVideo=false] - video 入力なら ffmpeg -vn で audio 抽出を強制
 * @param {string} [options.messageType='voice'] - webhook payload の type ('voice' | 'video' | 'audio')
 */
async function transcribeMessage(messageId, filePath, options = {}) {
  const {
    io = null,
    roomId = null,
    version = 1,
    isVideo = false,
    messageType = 'voice',
  } = options;
  const fullPath = path.join(MEDIA_ROOT, filePath);
  let tempPath = null;

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
    let ext;

    if (isVideo) {
      // Video: ffmpeg -vn で audio 抽出 (Whisper API 25MB 上限対策)
      // mp3 VBR -q:a 4 ≈ 128kbps、1 時間で ~58MB だが Whisper API は最大 25MB なので
      // ~20 分動画まで対応。長尺は将来 chunk 分割で対応 (out of scope for Phase 1)。
      // codec=mp3 で Windows ffmpeg 標準ビルド互換 (libopus は build-dependent)
      tempPath = path.join(path.dirname(fullPath), `tealus-stt-${messageId}-v${version}.mp3`);
      try {
        const { execSync } = require('child_process');
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
        const stderr = e.stderr ? e.stderr.toString() : '';
        const stderrTail = stderr ? `\nffmpeg stderr (last 500 chars): ${stderr.slice(-500)}` : '';
        throw new Error(`ffmpeg video → audio extraction failed: ${e.message}${stderrTail}`);
      }
    } else {
      // Voice / Audio: detect format, fallback to mp3 conversion if unknown
      const { fileTypeFromFile } = await import('file-type');
      const fileInfo = await fileTypeFromFile(fullPath);
      ext = fileInfo ? fileInfo.ext : path.extname(fullPath).replace('.', '') || 'webm';
      const whisperFormats = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'];
      if (!whisperFormats.includes(ext)) ext = 'webm';

      if (!fileInfo) {
        tempPath = fullPath + '.converted.mp3';
        try {
          const { execSync } = require('child_process');
          execSync(`ffmpeg -i "${fullPath}" -y -q:a 2 "${tempPath}" 2>/dev/null`);
          inputPath = tempPath;
          ext = 'mp3';
        } catch (e) {
          if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          tempPath = null;
        }
      }
    }

    // Call Whisper API — use File object with correct name for content-type detection
    const fileBuffer = fs.readFileSync(inputPath);
    const file = new File([fileBuffer], `audio.${ext}`, {
      type: ext === 'mp3' ? 'audio/mpeg'
          : ext === 'mp4' ? 'audio/mp4'
          : ext === 'ogg' ? 'audio/ogg'
          : `audio/${ext}`,
    });

    const whisperPrompt = buildWhisperPrompt(loadGuideline(), WHISPER_MODEL);
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: WHISPER_MODEL,
      language: 'ja',
      ...(whisperPrompt ? { prompt: whisperPrompt } : {}),
    });

    let rawText = transcription.text || '';
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
        const { fireWebhooks } = require('./webhook');
        const msgRes = await pool.query('SELECT sender_id FROM messages WHERE id = $1', [messageId]);
        fireWebhooks('voice.transcription_completed', roomId, {
          room: { id: roomId },
          message: { id: messageId, type: messageType, sender: { id: msgRes.rows[0]?.sender_id } },
          transcription: { raw_text: rawText, formatted_text: rawText },
        });
      }
    } else {
      // 通常: AI formatting
      await formatTranscription(messageId, rawText, io, roomId, version, messageType);
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
async function transcribeVoiceMessage(messageId, filePath, io, roomId, version = 1) {
  return transcribeMessage(messageId, filePath, { io, roomId, version, isVideo: false, messageType: 'voice' });
}

module.exports = { transcribeMessage, transcribeVoiceMessage };

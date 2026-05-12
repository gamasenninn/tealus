const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const pool = require('../db/pool');
const { formatTranscription } = require('./formatting');
const { loadGuideline, buildWhisperPrompt } = require('./transcriptionConfig');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// #217: gpt-4o-transcribe を default 採用 (whisper-1 比 hallucination 軽減、コスト同等)。
// env で whisper-1 / gpt-4o-mini-transcribe にも切替可能。
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'gpt-4o-transcribe';
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
      // 16kHz mono opus 24kbps ≈ 11MB/hour、長尺動画でも 25MB 内に収まりやすい
      tempPath = path.join(path.dirname(fullPath), `tealus-stt-${messageId}-v${version}.ogg`);
      try {
        const { execSync } = require('child_process');
        execSync(
          `ffmpeg -i "${fullPath}" -y -vn -ar 16000 -ac 1 -c:a libopus -b:a 24k "${tempPath}" 2>/dev/null`,
          { stdio: 'pipe' }
        );
        inputPath = tempPath;
        ext = 'ogg';
        logger.info(`[transcribe] video audio extracted: ${path.basename(tempPath)} (${fs.statSync(tempPath).size} bytes)`);
      } catch (e) {
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        tempPath = null;
        throw new Error(`ffmpeg video → audio extraction failed: ${e.message}`);
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

    const whisperPrompt = buildWhisperPrompt(loadGuideline());
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: WHISPER_MODEL,
      language: 'ja',
      ...(whisperPrompt ? { prompt: whisperPrompt } : {}),
    });

    const rawText = transcription.text;

    // Save raw text, proceed to formatting
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

    // AI formatting
    await formatTranscription(messageId, rawText, io, roomId, version, messageType);

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

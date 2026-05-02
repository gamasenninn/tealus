const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

/**
 * PUT /api/messages/:id/transcription
 * Edit transcription text (sender only)
 */
router.put('/', authenticate, async (req, res) => {
  const messageId = req.params.id;
  const userId = req.user.id;
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'テキストは必須です' });
  }

  try {
    // Check message exists
    const msgResult = await pool.query(
      'SELECT m.sender_id, m.room_id, r.allow_member_transcription_edit FROM messages m JOIN rooms r ON r.id = m.room_id WHERE m.id = $1 AND m.type = $2',
      [messageId, 'voice']
    );
    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const { sender_id, room_id, allow_member_transcription_edit } = msgResult.rows[0];

    if (sender_id !== userId) {
      if (!allow_member_transcription_edit) {
        return res.status(403).json({ error: '送信者のみ編集できます' });
      }
      // ルーム設定でメンバー編集が許可されている場合、メンバーかチェック
      const memberCheck = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [room_id, userId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'ルームメンバーのみ編集できます' });
      }
    }

    // Get current max version
    const versionResult = await pool.query(
      'SELECT MAX(version) as max_version FROM voice_transcriptions WHERE message_id = $1',
      [messageId]
    );
    const newVersion = (versionResult.rows[0].max_version || 0) + 1;

    // Get raw_text from latest version
    const latestResult = await pool.query(
      'SELECT raw_text FROM voice_transcriptions WHERE message_id = $1 ORDER BY version DESC LIMIT 1',
      [messageId]
    );
    const rawText = latestResult.rows[0]?.raw_text || '';

    // Insert new version
    const result = await pool.query(
      `INSERT INTO voice_transcriptions (message_id, version, raw_text, formatted_text, status, edited_by)
       VALUES ($1, $2, $3, $4, 'done', $5)
       RETURNING message_id, version, raw_text, formatted_text, status`,
      [messageId, newVersion, rawText, text.trim(), userId]
    );

    const transcription = result.rows[0];

    // Broadcast update
    const { io } = require('../app');
    const roomId = msgResult.rows[0].room_id;
    io.to(roomId).emit('voice:transcription', {
      message_id: messageId,
      status: 'done',
      raw_text: rawText,
      formatted_text: text.trim(),
      version: newVersion,
    });

    res.json({ transcription });
  } catch (err) {
    logger.error('Transcription edit error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/messages/:id/transcription/history
 * Get transcription edit history (room members only)
 */
router.get('/history', authenticate, async (req, res) => {
  const messageId = req.params.id;
  const userId = req.user.id;

  try {
    // Check message exists and user is room member
    const msgResult = await pool.query(
      'SELECT room_id FROM messages WHERE id = $1',
      [messageId]
    );
    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [msgResult.rows[0].room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'このルームにアクセスする権限がありません' });
    }

    const result = await pool.query(
      `SELECT vt.message_id, vt.version, vt.raw_text, vt.formatted_text, vt.status, vt.edited_by, vt.created_at,
              u.display_name AS edited_by_name
       FROM voice_transcriptions vt
       LEFT JOIN users u ON u.id = vt.edited_by
       WHERE vt.message_id = $1
       ORDER BY vt.version DESC`,
      [messageId]
    );

    res.json({ history: result.rows });
  } catch (err) {
    logger.error('Transcription history error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/messages/:id/transcription/retranscribe
 * Retry transcription (creates new version with status='pending')
 * #216: Whisper 失敗時の再実行機能
 */
router.post('/retranscribe', authenticate, async (req, res) => {
  const messageId = req.params.id;
  const userId = req.user.id;

  try {
    // Check message exists + permission (same logic as PUT)
    const msgResult = await pool.query(
      'SELECT m.sender_id, m.room_id, r.allow_member_transcription_edit FROM messages m JOIN rooms r ON r.id = m.room_id WHERE m.id = $1 AND m.type = $2',
      [messageId, 'voice']
    );
    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const { sender_id, room_id, allow_member_transcription_edit } = msgResult.rows[0];

    if (sender_id !== userId) {
      if (!allow_member_transcription_edit) {
        return res.status(403).json({ error: '送信者のみ再文字起こしできます' });
      }
      const memberCheck = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [room_id, userId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'ルームメンバーのみ再文字起こしできます' });
      }
    }

    // Get audio file path from message_media
    const mediaResult = await pool.query(
      'SELECT file_path FROM message_media WHERE message_id = $1 LIMIT 1',
      [messageId]
    );
    if (mediaResult.rows.length === 0) {
      return res.status(404).json({ error: '音声ファイルが見つかりません' });
    }
    const filePath = mediaResult.rows[0].file_path;

    // Compute new version
    const versionResult = await pool.query(
      'SELECT MAX(version) as max_version FROM voice_transcriptions WHERE message_id = $1',
      [messageId]
    );
    const newVersion = (versionResult.rows[0].max_version || 0) + 1;

    // Insert new version row with status='pending', edited_by=requestUser
    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, version, status, edited_by)
       VALUES ($1, $2, 'pending', $3)`,
      [messageId, newVersion, userId]
    );

    // Respond immediately (async transcription kicks off)
    res.status(202).json({
      message_id: messageId,
      version: newVersion,
      status: 'pending',
    });

    // Async transcription on the new version
    const { io } = require('../app');
    const { transcribeVoiceMessage } = require('../services/transcription');
    transcribeVoiceMessage(messageId, filePath, io, room_id, newVersion).catch(err => {
      logger.error('Retranscribe error:', err);
    });
  } catch (err) {
    logger.error('Retranscribe error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;

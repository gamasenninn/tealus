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
    // Check message exists and user is sender
    const msgResult = await pool.query(
      'SELECT sender_id, room_id FROM messages WHERE id = $1 AND type = $2',
      [messageId, 'voice']
    );
    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }
    if (msgResult.rows[0].sender_id !== userId) {
      return res.status(403).json({ error: '送信者のみ編集できます' });
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

module.exports = router;

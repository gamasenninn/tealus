const logger = require('../../utils/logger');
const E = require('../../constants/errors');
const express = require('express');
const { resetCache, loadGuideline } = require('../../services/transcriptionConfig');

const router = express.Router();

/**
 * POST /api/admin/transcription/reload-vocab
 *
 * `server/config/transcription_guideline.json` の更新を server restart なしで
 * runtime cache に反映する admin endpoint (#286 Phase 1)。
 * Phase 2 (organon-daily skill Step 4) でファイル更新後に本 endpoint を呼ぶことで、
 * 次の transcription から新 vocab が bias 効く。
 *
 * 順序が重要: resetCache → loadGuideline (loadGuideline は cache 有無で挙動が変わる、
 * 必ず先に reset してから load し直す)。
 */
router.post('/transcription/reload-vocab', (req, res) => {
  try {
    resetCache();
    const config = loadGuideline();
    logger.info(`[admin] vocab cache reloaded by ${req.user.login_id}: ${config.vocabulary.length} vocab, ${config.guidelines.length} rules`);
    res.json({
      vocab_count: config.vocabulary.length,
      guideline_count: config.guidelines.length,
    });
  } catch (err) {
    logger.error('Vocab reload error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;

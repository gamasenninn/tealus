/**
 * #327 辞書育成（admin）— 自己成長辞書のレビュー/トリアージ。
 *
 * 辞書は自分で埋まる（organon import + 自己成長）ので、人間の仕事は著述でなくトリアージ:
 * 自動学習された別名を 承認(active+manual=最上位) / 却下(tombstone) / 読み修正 する。
 * 状態変更後は refreshVocabFromTable でオーバーレイに即反映（active のみ補正段に効く）。
 */
const express = require('express');
const repo = require('../../services/dictionaryRepo');
const { refreshVocabFromTable } = require('../../services/transcriptionConfig');
const logger = require('../../utils/logger');
const E = require('../../constants/errors');

const router = express.Router();

// 一覧（既定 scope=auto = 自己成長分のトリアージ）
router.get('/dictionary/aliases', async (req, res) => {
  try {
    const scope = ['auto', 'all', 'rejected'].includes(req.query.scope) ? req.query.scope : 'auto';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const aliases = await repo.listAliasesForReview({ scope, search });
    res.json({ aliases });
  } catch (err) {
    logger.error('[dictionary] list error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// 承認（pending/auto → active + source=manual）
router.post('/dictionary/aliases/:id/approve', async (req, res) => {
  try {
    const row = await repo.approveAlias(req.params.id);
    if (!row) return res.status(404).json({ error: '別名が見つかりません' });
    await refreshVocabFromTable();
    logger.info(`[dictionary] approved ${row.alias} by ${req.user.login_id}`);
    res.json({ alias: row });
  } catch (err) {
    logger.error('[dictionary] approve error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// 却下（→ rejected tombstone）
router.post('/dictionary/aliases/:id/reject', async (req, res) => {
  try {
    const row = await repo.rejectAlias(req.params.id);
    if (!row) return res.status(404).json({ error: '別名が見つかりません' });
    await refreshVocabFromTable();
    logger.info(`[dictionary] rejected ${row.alias} by ${req.user.login_id}`);
    res.json({ alias: row });
  } catch (err) {
    logger.error('[dictionary] reject error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// 読み修正（term.reading 上書き）
router.patch('/dictionary/terms/:id/reading', async (req, res) => {
  try {
    const reading = typeof req.body.reading === 'string' ? req.body.reading.trim() : '';
    if (!reading) return res.status(400).json({ error: '読みを入力してください' });
    const row = await repo.setTermReading(req.params.id, reading);
    if (!row) return res.status(404).json({ error: '語が見つかりません' });
    await refreshVocabFromTable();
    logger.info(`[dictionary] reading updated ${row.term}=${reading} by ${req.user.login_id}`);
    res.json({ term: row });
  } catch (err) {
    logger.error('[dictionary] reading error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;

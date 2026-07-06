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
const { getReadings } = require('../../services/reading');
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

// 手動追加（garble→term を人間が明示追加）。term が無ければ pykakasi 読み付きで作成。
// source=manual + active（最上位・import 不可侵、tombstone も override）＝難読名など自動で拾えない語の経路。
router.post('/dictionary/aliases', async (req, res) => {
  try {
    const term = typeof req.body.term === 'string' ? req.body.term.trim() : '';
    const alias = typeof req.body.alias === 'string' ? req.body.alias.trim() : '';
    if (!term || !alias) return res.status(400).json({ error: '語と別名を入力してください' });
    if (term === alias) return res.status(400).json({ error: '語と別名が同一です' });

    let t = await repo.getTermByName(term);
    if (!t) {
      const reading = (typeof req.body.reading === 'string' && req.body.reading.trim())
        || (await getReadings([term])).get(term) || '';
      t = await repo.upsertTerm({ term, category: req.body.category || 'other', reading, source: 'manual' });
    }
    const { row } = await repo.upsertAlias({ termId: t.id, alias, source: 'manual', count: 0, status: 'active' });
    // 人間の明示追加 = active + source=manual を保証（既存 pending の昇格・tombstone の override 含む）
    const finalRow = await repo.approveAlias(row.id);
    await refreshVocabFromTable();
    logger.info(`[dictionary] manual add ${alias}→${term} by ${req.user.login_id}`);
    res.status(201).json({ alias: finalRow, term: t });
  } catch (err) {
    logger.error('[dictionary] manual add error:', err);
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

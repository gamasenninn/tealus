const logger = require('../../utils/logger');
const E = require('../../constants/errors');
const express = require('express');
const pool = require('../../db/pool');

const router = express.Router();

/**
 * GET /api/admin/portal-links
 */
router.get('/portal-links', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM portal_links ORDER BY sort_order, created_at');
    res.json({ links: result.rows });
  } catch (err) {
    logger.error('Admin list portal links error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/admin/portal-links
 */
router.post('/portal-links', async (req, res) => {
  const { title, url, icon } = req.body;
  if (!title || !url) {
    return res.status(400).json({ error: 'タイトルとURLは必須です' });
  }
  try {
    const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM portal_links');
    const result = await pool.query(
      `INSERT INTO portal_links (title, url, icon, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, url, icon || null, maxOrder.rows[0].next, req.user.id]
    );
    res.status(201).json({ link: result.rows[0] });
  } catch (err) {
    logger.error('Admin create portal link error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/admin/portal-links/:id
 */
router.put('/portal-links/:id', async (req, res) => {
  const { id } = req.params;
  const { title, url, icon, sort_order, is_active } = req.body;
  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;
    if (title !== undefined) { updates.push(`title = $${paramIndex++}`); values.push(title); }
    if (url !== undefined) { updates.push(`url = $${paramIndex++}`); values.push(url); }
    if (icon !== undefined) { updates.push(`icon = $${paramIndex++}`); values.push(icon); }
    if (sort_order !== undefined) { updates.push(`sort_order = $${paramIndex++}`); values.push(sort_order); }
    if (is_active !== undefined) { updates.push(`is_active = $${paramIndex++}`); values.push(is_active); }
    if (updates.length === 0) return res.status(400).json({ error: '更新する項目がありません' });
    values.push(id);
    const result = await pool.query(
      `UPDATE portal_links SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'リンクが見つかりません' });
    res.json({ link: result.rows[0] });
  } catch (err) {
    logger.error('Admin update portal link error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/admin/portal-links/:id
 */
router.delete('/portal-links/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM portal_links WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'リンクが見つかりません' });
    res.json({ success: true });
  } catch (err) {
    logger.error('Admin delete portal link error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;

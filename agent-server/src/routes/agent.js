/**
 * Agent control API — Deep agent の cancel など
 */
const express = require('express');
const logger = require('../lib/logger');
const deepRegistry = require('../agents/deepRegistry');
const botApi = require('../lib/botApi');

const router = express.Router();

router.post('/cancel', async (req, res) => {
  const { room_id } = req.body || {};
  if (!room_id) {
    return res.status(400).json({ error: 'room_id is required' });
  }
  const result = deepRegistry.cancel(room_id);
  if (result.was_running) {
    await botApi.pushStatus(room_id, 'idle').catch(() => {});
    await botApi.pushMessage(room_id, '⏹ 分析を中断しました。').catch(() => {});
  }
  logger.info(`[Cancel] room=${room_id} was_running=${result.was_running}`);
  res.json(result);
});

module.exports = router;

/**
 * Agent control API — Deep agent の cancel、cc-projects 一覧 など
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const logger = require('../lib/logger');
const deepRegistry = require('../agents/deepRegistry');
const botApi = require('../lib/botApi');
const { DEFAULT_QUEUE_DIR } = require('../webhook/ccQueue');

const router = express.Router();

// extractCcProject の regex と同じ。invalid な file 名 (manual で置かれた変な file) を除外
const PROJECT_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * #253: GET /agent/cc-projects — cc-queue jsonl から project 一覧を返す。
 * mention picker の virtual user 候補に使う。
 */
router.get('/cc-projects', (req, res) => {
  try {
    if (!fs.existsSync(DEFAULT_QUEUE_DIR)) {
      return res.json({ projects: [] });
    }
    const files = fs.readdirSync(DEFAULT_QUEUE_DIR);
    const projects = [];
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const name = f.slice(0, -6);
      if (!PROJECT_NAME_RE.test(name)) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(path.join(DEFAULT_QUEUE_DIR, f)).mtimeMs;
      } catch {}
      projects.push({ name, mtime_ms: mtimeMs });
    }
    projects.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ projects });
  } catch (err) {
    logger.error(`[cc-projects] list error: ${err.message}`);
    res.status(500).json({ error: 'failed to list cc-projects' });
  }
});

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

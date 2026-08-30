/**
 * Agent control API — Deep agent の cancel、cc-projects 一覧 など
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { logger } from '../lib/logger.mts';
import * as deepRegistry from '../agents/deepRegistry.mts';
import * as lightRegistry from '../agents/lightRegistry.mts';
import * as botApi from '../lib/botApi.mts';
import { DEFAULT_QUEUE_DIR } from '../webhook/ccQueue.mts';
import { getBotIdentity } from '../webhook/handler.mts';

export const router = express.Router();

/**
 * #338 Phase 1: GET /agent/identity — アプリ内アシスタントの identity を返す。
 * クライアントの「エージェントに送る」compose ヘルパーが、正しい宛先メンション
 * (@<display_name>) を組み立て、他の bot (LINE 等) と区別するのに使う。
 */
router.get('/identity', (req, res) => {
  res.json(getBotIdentity());
});

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
    const projects: Array<{ name: string; mtime_ms: number }> = [];
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const name = f.slice(0, -6);
      if (!PROJECT_NAME_RE.test(name)) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(path.join(DEFAULT_QUEUE_DIR, f)).mtimeMs;
      } catch { /* ignore */ }
      projects.push({ name, mtime_ms: mtimeMs });
    }
    projects.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ projects });
  } catch (err) {
    logger.error(`[cc-projects] list error: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: 'failed to list cc-projects' });
  }
});

/**
 * 実行中の agent を中断する。
 *
 * Deep (#250) と Light (通常応答) の両方を見る。同一 room で両方が同時に走ることは無いので、
 * Deep → Light の順に試し、当たった方の文言を出す。
 */
router.post('/cancel', async (req, res) => {
  const { room_id } = (req.body || {}) as { room_id?: string };
  if (!room_id) {
    return res.status(400).json({ error: 'room_id is required' });
  }
  let tier: 'deep' | 'light' | null = null;
  let result = deepRegistry.cancel(room_id);
  if (result.was_running) {
    tier = 'deep';
  } else {
    result = lightRegistry.cancel(room_id);
    if (result.was_running) tier = 'light';
  }
  if (tier) {
    await botApi.pushStatus(room_id, 'idle').catch(() => {});
    const notice = tier === 'deep' ? '⏹ 分析を中断しました。' : '⏹ 応答を中断しました。';
    await botApi.pushMessage(room_id, notice).catch(() => {});
  }
  logger.info(`[Cancel] room=${room_id} was_running=${result.was_running} tier=${tier || '-'}`);
  res.json({ ...result, tier });
});

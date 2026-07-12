/**
 * ログ API
 * ダッシュボードからログファイルを閲覧
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

export const router = express.Router();
const LOG_DIR = path.join(import.meta.dirname, '..', '..', 'logs');

interface LogEntry {
  level?: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * GET /logs/dates — 利用可能な日付一覧
 */
router.get('/dates', (req, res) => {
  try {
    if (!fs.existsSync(LOG_DIR)) return res.json({ dates: [] });
    const files = fs.readdirSync(LOG_DIR)
      .filter((f) => f.startsWith('agent-') && f.endsWith('.log'))
      .map((f) => f.replace('agent-', '').replace('.log', ''))
      .sort()
      .reverse();
    res.json({ dates: files });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /logs — ログ取得
 * ?date=YYYY-MM-DD（デフォルト: 今日）
 * ?limit=100（デフォルト: 100）
 * ?offset=0
 * ?level=error（任意）
 * ?q=keyword（任意）
 */
router.get('/', (req, res) => {
  const { date, limit = '100', offset = '0', level, q } = req.query as {
    date?: string;
    limit?: string;
    offset?: string;
    level?: string;
    q?: string;
  };
  const limitNum = Math.min(parseInt(limit) || 100, 500);
  const offsetNum = parseInt(offset) || 0;

  try {
    // 対象日のログファイル（ローカル時間）
    const now = new Date();
    const targetDate = date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const filePath = path.join(LOG_DIR, `agent-${targetDate}.log`);

    let lines: string[] = [];
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      lines = content.split('\n').filter((l) => l.trim());
    }

    // 今日のファイルが limit 未満で date 未指定なら前日も合算
    if (!date && lines.length < limitNum + offsetNum) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yy = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      const prevPath = path.join(LOG_DIR, `agent-${yy}.log`);
      if (fs.existsSync(prevPath)) {
        const prevContent = fs.readFileSync(prevPath, 'utf8');
        const prevLines = prevContent.split('\n').filter((l) => l.trim());
        lines = [...prevLines, ...lines];
      }
    }

    // JSON パース
    let entries: LogEntry[] = lines.map((line) => {
      try { return JSON.parse(line) as LogEntry; } catch { return null; }
    }).filter((e): e is LogEntry => e !== null);

    // レベルフィルタ
    if (level) {
      entries = entries.filter((e) => e.level === level);
    }

    // キーワード検索
    if (q) {
      const keyword = q.toLowerCase();
      entries = entries.filter((e) => (e.message || '').toLowerCase().includes(keyword));
    }

    const total = entries.length;

    // 新しい順にして、ページネーション
    entries.reverse();
    entries = entries.slice(offsetNum, offsetNum + limitNum);

    res.json({ logs: entries, total, date: targetDate });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

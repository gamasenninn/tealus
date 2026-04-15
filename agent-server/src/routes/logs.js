/**
 * ログ API
 * ダッシュボードからログファイルを閲覧
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

/**
 * GET /logs/dates — 利用可能な日付一覧
 */
router.get('/dates', (req, res) => {
  try {
    if (!fs.existsSync(LOG_DIR)) return res.json({ dates: [] });
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('agent-') && f.endsWith('.log'))
      .map(f => f.replace('agent-', '').replace('.log', ''))
      .sort()
      .reverse();
    res.json({ dates: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  const { date, limit = '100', offset = '0', level, q } = req.query;
  const limitNum = Math.min(parseInt(limit) || 100, 500);
  const offsetNum = parseInt(offset) || 0;

  try {
    // 対象日のログファイル（ローカル時間）
    const now = new Date();
    const targetDate = date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const filePath = path.join(LOG_DIR, `agent-${targetDate}.log`);

    let lines = [];
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      lines = content.split('\n').filter(l => l.trim());
    }

    // 今日のファイルが limit 未満で date 未指定なら前日も合算
    if (!date && lines.length < limitNum + offsetNum) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yy = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      const prevPath = path.join(LOG_DIR, `agent-${yy}.log`);
      if (fs.existsSync(prevPath)) {
        const prevContent = fs.readFileSync(prevPath, 'utf8');
        const prevLines = prevContent.split('\n').filter(l => l.trim());
        lines = [...prevLines, ...lines];
      }
    }

    // JSON パース
    let entries = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    // レベルフィルタ
    if (level) {
      entries = entries.filter(e => e.level === level);
    }

    // キーワード検索
    if (q) {
      const keyword = q.toLowerCase();
      entries = entries.filter(e => (e.message || '').toLowerCase().includes(keyword));
    }

    const total = entries.length;

    // 新しい順にして、ページネーション
    entries.reverse();
    entries = entries.slice(offsetNum, offsetNum + limitNum);

    res.json({ logs: entries, total, date: targetDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

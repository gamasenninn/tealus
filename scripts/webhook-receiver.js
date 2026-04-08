#!/usr/bin/env node
/**
 * Tealus Webhook 受信テストサーバー
 *
 * Webhookの動作確認用。受信したペイロードをコンソールに表示する。
 *
 * Usage:
 *   node scripts/webhook-receiver.js
 *   node scripts/webhook-receiver.js --port 8888
 *   node scripts/webhook-receiver.js --secret my-secret-key
 *
 * 管理画面で以下のURLを登録:
 *   http://localhost:9999/webhook
 */
const http = require('http');
const crypto = require('crypto');

// --- 引数パース ---
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const secretIdx = args.indexOf('--secret');
const PORT = portIdx !== -1 ? parseInt(args[portIdx + 1]) : 9999;
const SECRET = secretIdx !== -1 ? args[secretIdx + 1] : null;

// --- サーバー ---
const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const timestamp = new Date().toLocaleTimeString('ja-JP');

    // 署名検証
    if (SECRET) {
      const expected = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
      const received = (req.headers['x-tealus-signature'] || '').replace('sha256=', '');
      const valid = expected === received;
      console.log(`[${timestamp}] 署名: ${valid ? '✅ 有効' : '❌ 無効'}`);
      if (!valid) {
        console.log(`  期待: sha256=${expected}`);
        console.log(`  受信: ${req.headers['x-tealus-signature'] || '(なし)'}`);
      }
    }

    // ペイロード表示
    try {
      const payload = JSON.parse(body);
      console.log(`[${timestamp}] イベント: ${payload.event}`);
      if (payload.room) {
        console.log(`  ルーム: ${payload.room.name || '(名前なし)'} (${payload.room.id})`);
      }
      if (payload.message) {
        const msg = payload.message;
        console.log(`  送信者: ${msg.sender?.display_name || '不明'}`);
        console.log(`  タイプ: ${msg.type || 'text'}`);
        if (msg.content) {
          const preview = msg.content.length > 60 ? msg.content.slice(0, 60) + '...' : msg.content;
          console.log(`  内容: ${preview}`);
        }
      }
      console.log('');
    } catch (e) {
      console.log(`[${timestamp}] 受信（JSON解析失敗）: ${body.slice(0, 200)}`);
      console.log('');
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('  Tealus Webhook 受信テストサーバー');
  console.log('='.repeat(50));
  console.log(`  URL: http://localhost:${PORT}/webhook`);
  console.log(`  署名検証: ${SECRET ? '有効 (secret: ' + SECRET + ')' : '無効'}`);
  console.log('');
  console.log('  管理画面 → Webhook → 上記URLを登録');
  console.log('  Ctrl+C で終了');
  console.log('');
});

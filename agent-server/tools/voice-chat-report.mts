/**
 * #410 会話モードの計測ログをまとめて表示する。
 *
 *   node --env-file=.env tools/voice-chat-report.mts
 *   node --env-file=.env tools/voice-chat-report.mts --since 2026-09-06
 *
 * ★ 数え方は `src/lib/voiceChatReport.mts` にあり、テストで固定してある。
 *   ここは **読んで渡すだけ** —— 集計をその場で書くと、回ごとに分母が変わる (それが #410)。
 *
 * ★★ 逐語は 1 週間で消える (#389/#407) ので、**測り直しは期限内に行うこと**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { summarizeVoiceChat, formatVoiceChatReport, parseSinceJst, type VoiceChatRecord } from '../src/lib/voiceChatReport.mts';

const root = path.resolve(process.env.AGENT_WORKSPACE_ROOT || './agent-workspaces');
const dir = path.join(root, '_voice-chat-logs');

const sinceArg = process.argv.indexOf('--since');
// ★ 日付だけのときは JST の 0 時として読む (UTC 解釈だと午前のセッションが黙って落ちる)
const since = sinceArg >= 0 ? parseSinceJst(process.argv[sinceArg + 1]) : null;
if (since && Number.isNaN(since.getTime())) {
  console.error('--since の日付を読めません (例: --since 2026-09-06)');
  process.exit(1);
}

if (!fs.existsSync(dir)) {
  console.error(`計測ログの置き場がありません: ${dir}`);
  process.exit(1);
}

const records: VoiceChatRecord[] = [];
let files = 0;
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.jsonl')) continue;
  const full = path.join(dir, name);
  if (since && fs.statSync(full).mtimeMs < since.getTime()) continue;
  files += 1;
  for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as VoiceChatRecord);
    } catch {
      console.warn(`読めない行を飛ばしました: ${name}`);
    }
  }
}

// ★ 「いつ時点の数字か」を必ず添える (件数だけを持ち出せない形にする)
const asOf = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
console.log(`置き場 ${dir}  ファイル ${files} 件${since ? ` (--since ${process.argv[sinceArg + 1]})` : ''}\n`);
console.log(formatVoiceChatReport(summarizeVoiceChat(records), `${asOf} JST`));

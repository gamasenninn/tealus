/**
 * #419 workspace の中にある `.codex_home` を、外の `_codex-homes/` へ移す (1 回限りの移行)。
 *
 * ★ 中身は **ChatGPT の OAuth トークン (auth.json)** と
 *   **OPENAI_API_KEY / GOOGLE_API_KEY / TEALUS_PASSWORD (config.toml)**、
 *   さらに **codex のセッション記録 (sessions/rollout-*.jsonl、中身に鍵が写り込む)**。
 *   workspace は filesystem MCP の root なので、そこに在ると `read_file` で読める。
 *
 * ★★ **削除ではなく移動**にしてある。セッション記録を失わずに、読める場所からだけ外す。
 *   (`prepareCodexHome` は次に走ったときに古いものを消すが、それだと記録ごと消える)
 *
 * ★★★ 前後で **ファイル総数が一致するか**を必ず出す。移し忘れ / 消えた を、
 *   件数 1 本で捕まえるため (「移した」と言って移せていないのが、この issue の前回の失敗)。
 *
 *   node --env-file=.env scripts/migrate-codex-homes.mts          # 下見 (何もしない)
 *   node --env-file=.env scripts/migrate-codex-homes.mts --apply  # 実行
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.env.AGENT_WORKSPACE_ROOT || './agent-workspaces');
const apply = process.argv.includes('--apply');

/** `<root>/<agentId>/<roomId>/.codex_home` を集める (深さを決め打ちにしない) */
function findCodexHomes(dir: string, depth = 0): string[] {
  if (depth > 3) return [];
  let out: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name === '.codex_home') out.push(p);
    else if (!e.name.startsWith('_')) out = out.concat(findCodexHomes(p, depth + 1));
  }
  return out;
}

/** 配下のファイル総数 (中身は読まない = 鍵を目にしない) */
function countFiles(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

const homes = findCodexHomes(root).sort();
if (!homes.length) {
  console.log(`workspace の中に .codex_home はありません (${root})`);
  process.exit(0);
}

const asOf = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
console.log(`置き場 ${root}   as of ${asOf} JST`);
console.log(`${apply ? '★ 実行' : '下見 (--apply で実行)'}\n`);

let before = 0;
const plan: Array<{ from: string; to: string; files: number }> = [];
for (const from of homes) {
  const roomId = path.basename(path.dirname(from));
  const agentId = path.basename(path.dirname(path.dirname(from)));
  const to = path.join(root, '_codex-homes', agentId, roomId);
  const files = countFiles(from);
  before += files;
  plan.push({ from, to, files });
  console.log(`  ${roomId.slice(0, 8)}  ファイル ${String(files).padStart(3)} 件  → _codex-homes/${agentId.slice(0, 8)}/${roomId.slice(0, 8)}`
    + (fs.existsSync(to) ? '   ★ 移動先が既にある (手で確認すること)' : ''));
}
console.log(`\n合計 ${plan.length} ルーム / ファイル ${before} 件`);

if (!apply) process.exit(0);

let moved = 0, skipped = 0;
for (const { from, to } of plan) {
  if (fs.existsSync(to)) { console.log(`  skip (移動先が既にある): ${to}`); skipped += 1; continue; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  moved += 1;
}

// ★ 検算: 移したあとに、元の場所が空で、移動先の総数が一致すること
const leftover = findCodexHomes(root);
let after = 0;
for (const { to } of plan) if (fs.existsSync(to)) after += countFiles(to);

console.log(`\n=== 結果 ===`);
console.log(`移した        ${moved} ルーム (skip ${skipped})`);
console.log(`workspace 内に残った .codex_home  ${leftover.length} 件`);
console.log(`ファイル総数  移行前 ${before} → 移行後 ${after}  ${before === after ? '★ 一致' : '★★ 不一致 —— 確認すること'}`);

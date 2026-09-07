/**
 * #419 **ルームの workspace (= filesystem MCP の root) から資格情報が読めないこと**を確かめる。
 *
 * ★★ 前回 (2026-09-06) は「残存 0 件」と報告して外した。**走査が 1 階層しか見ていなかった** ——
 *   `workspace/*` だけを見て `workspace/.codex_home/` の中を見ていなかった。
 *   → ★ ここでは **隠しディレクトリを含めて全深さ**を歩く。ripgrep 等は既定で dot-dir を飛ばすので使わない。
 *
 * ★ **値は絶対に出さない。** 出すのは「どのファイルに、どの種類が、何件」だけ。
 *
 *   node --env-file=.env scripts/scan-workspace-secrets.mts
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.env.AGENT_WORKSPACE_ROOT || './agent-workspaces');

/** 探す形。★ 値そのものは記録しない (名前と件数だけ) */
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'OPENAI_API_KEY', re: /OPENAI_API_KEY/ },
  { name: 'GOOGLE_API_KEY', re: /GOOGLE_API_KEY/ },
  { name: 'TEALUS_PASSWORD', re: /TEALUS_PASSWORD/ },
  { name: 'ANTHROPIC_API_KEY', re: /ANTHROPIC_API_KEY/ },
  { name: 'TAVILY_API_KEY', re: /TAVILY_API_KEY/ },
  { name: 'sk- で始まる鍵', re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: 'DSN (user:pass@host)', re: /\b(?:mysql|postgres(?:ql)?|mongodb):\/\/[^\s"']*:[^\s"'@]+@/ },
  { name: 'OAuth の refresh token', re: /"refresh_token"\s*:\s*"[^"]{8,}/ },
  { name: 'id_token / access_token', re: /"(?:id_token|access_token)"\s*:\s*"[^"]{8,}/ },
];

/** ★ 中身を見るには重すぎる / 意味が無いもの (件数には出す) */
const BINARY_EXT = new Set(['.sqlite', '.sqlite-wal', '.sqlite-shm', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.mp4', '.wav', '.zip', '.pdf', '.node', '.wasm']);
const MAX_BYTES = 2_000_000;

interface Hit { file: string; kinds: string[] }
const hits: Hit[] = [];
let scanned = 0, skippedBig = 0, binary = 0;

function walk(dir: string) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    // ★ 隠しディレクトリも入る (前回の見落としがここ)
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (BINARY_EXT.has(ext)) { binary += 1; continue; }
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.size > MAX_BYTES) { skippedBig += 1; continue; }
    let text: string;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    scanned += 1;
    const kinds = PATTERNS.filter((x) => x.re.test(text)).map((x) => x.name);
    if (kinds.length) hits.push({ file: path.relative(root, p), kinds });
  }
}

// ★ ルームの workspace = <root>/<agentId>/<roomId>。`_` 始まりは workspace の外なので対象外
const targets: string[] = [];
for (const agent of fs.readdirSync(root, { withFileTypes: true })) {
  if (!agent.isDirectory() || agent.name.startsWith('_')) continue;
  targets.push(path.join(root, agent.name));
}

const asOf = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
console.log(`走査対象 (= filesystem MCP から読める範囲)  as of ${asOf} JST`);
for (const t of targets) console.log(`  ${path.relative(root, t)}`);
console.log('');
for (const t of targets) walk(t);

console.log(`テキストを読んだ ${scanned} 件 / 大きすぎて飛ばした ${skippedBig} 件 / バイナリ ${binary} 件`);
console.log('');
if (!hits.length) {
  console.log('★ 資格情報らしきものは 0 件でした (値は一切出していません)');
} else {
  console.log(`★★ ${hits.length} 件ありました —— ファイル名と種類だけ出します`);
  for (const h of hits) console.log(`  ${h.kinds.join(' / ')}\n    ${h.file}`);
}

// ★ 参考: workspace の中に「コードが書く」ものが戻っていないか (名前だけで数える)
const NAMES = ['.codex_home', '.deep_mcp_config.json'];
let backAgain = 0;
function countNames(dir: string) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (NAMES.includes(e.name)) { backAgain += 1; console.log(`  ★ 戻っている: ${path.relative(root, path.join(dir, e.name))}`); }
    if (e.isDirectory()) countNames(path.join(dir, e.name));
  }
}
console.log('');
for (const t of targets) countNames(t);
console.log(`コードが workspace に書くもの (.codex_home / .deep_mcp_config.json): ${backAgain} 件`);

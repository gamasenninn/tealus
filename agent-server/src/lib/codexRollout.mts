/**
 * codex が残す会話の記録 (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<日時>-<会話の ID>.jsonl`) を、部屋ごとの置き場へ移す
 * (2026-10-27 小野さん判断、承認 12)。
 *
 * ★ Light v2 は codex SDK で動き、CODEX_HOME を切り替えていないので、記録 (本文・画像の base64 入り) が
 *   利用者のホームの .codex に溜まっていた。Deep は #419 で `_codex-homes/<agentId>/<roomId>` に出している。
 * ★ CODEX_HOME ごと切り替えないのは、Light v2 は部屋ごとに並んで走り、認証のファイルを部屋ごとに写すと、
 *   途中で更新された鍵が写し同士でぶつかる (refresh_token_reused) ため。走り終えたその回の記録だけを会話の ID で移す
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from './logger.mts';

/**
 * ★ #419 部屋ごとの codex の置き場 (Deep の CODEX_HOME、Light v2 の会話の記録)。**workspace の外**に置く。
 *   `<WORKSPACE_ROOT>/_codex-homes/<agentId>/<roomId>` (workspacePath から 2 つ上が WORKSPACE_ROOT)
 */
export function codexHomePath(workspacePath: string): string {
  const roomDir = path.basename(workspacePath);
  const agentDir = path.basename(path.dirname(workspacePath));
  const workspaceRoot = path.dirname(path.dirname(workspacePath));
  return path.join(workspaceRoot, '_codex-homes', agentDir, roomDir);
}

const THREAD_ID_RE = /^[0-9a-f-]{8,64}$/i;

const dayDir = (d: Date) => path.join(String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));

/**
 * @param destDir 部屋の置き場 (`_codex-homes/<agentId>/<roomId>`)。記録はその下の sessions/ へ
 * @returns 移した先のパス。見つからない・失敗したら null (例外は出さない)
 */
export function moveCodexRollout(
  threadId: string | null | undefined,
  destDir: string,
  opts: { codexHome?: string; now?: Date } = {},
): string | null {
  if (!threadId || !THREAD_ID_RE.test(threadId)) return null;
  const codexHome = opts.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  const now = opts.now ?? new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);   // ★ 日付をまたいだ回は、始まった日のフォルダにある
  const suffix = `-${threadId}.jsonl`;
  try {
    for (const d of [now, yesterday]) {
      const dir = path.join(codexHome, 'sessions', dayDir(d));
      if (!fs.existsSync(dir)) continue;
      const name = fs.readdirSync(dir).find((n) => n.startsWith('rollout-') && n.endsWith(suffix));
      if (!name) continue;
      const toDir = path.join(destDir, 'sessions');
      fs.mkdirSync(toDir, { recursive: true });
      const to = path.join(toDir, name);
      try {
        fs.renameSync(path.join(dir, name), to);
      } catch {
        fs.copyFileSync(path.join(dir, name), to);   // ★ 別のドライブなら rename できない
        fs.unlinkSync(path.join(dir, name));
      }
      return to;
    }
  } catch (err) {
    logger.warn(`[codexRollout] 会話の記録を移せませんでした (${threadId}): ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

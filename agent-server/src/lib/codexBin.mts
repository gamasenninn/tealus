/**
 * #423 どの codex を起動するかを決める。
 *
 * ★★ **2026-09-06 に踏んだ形**: グローバルの codex を alpha (0.154.0-alpha.3) に上げても
 *   Deep が直らなかった。**agent-server は `npm start` で起動するので、PATH の先頭に
 *   `node_modules/.bin` が入る**。`@openai/codex-sdk` が連れてくる **ローカルの codex 0.128.0**
 *   が使われていた。★ サーバを再起動しても同じものを拾うので、再起動でも直らない。
 *
 * ★★★ 一番の問題は「古い版が使われたこと」ではなく、**どれが使われているかが外から
 *   見えなかったこと**。手元で `codex --version` を叩いても、それは**手元の PATH の答え**で
 *   あって、agent が起動するものとは限らない。→ 明示指定 + 起動時のログで見えるようにする。
 */

import fs from 'fs';
import path from 'path';

/** このパッケージの node_modules/.bin (`@openai/codex-sdk` が連れてくる codex の置き場) */
const LOCAL_BIN_DIR = path.join(import.meta.dirname, '..', '..', 'node_modules', '.bin');

/**
 * `AGENT_CODEX_BIN` があればそれを、無ければ **このパッケージの node_modules/.bin の codex**、
 * それも無ければ PATH に任せる。★ 絶対パスを推奨 (PATH の解決順に依存しなくなる)。
 *
 * ★★ 2026-10-16: 手元の codex を先に見るのは `npm start` の PATH と同じ順。node 直起動
 *   (Docker の CMD) では PATH に node_modules/.bin が入らず Deep が codex を見つけなかった。
 *   また手元の codex は Light v2 (codex-sdk) と同じ版なので、モデルの提供終了で上げる先が 1 つで済む。
 */
export function resolveCodexBin(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
  { localBinDir = LOCAL_BIN_DIR, exists = fs.existsSync }: { localBinDir?: string; exists?: (p: string) => boolean } = {},
): string {
  const explicit = (env.AGENT_CODEX_BIN || '').trim();
  if (explicit) return explicit;
  const name = platform === 'win32' ? 'codex.cmd' : 'codex';
  const local = path.join(localBinDir, name);
  if (exists(local)) return local;
  return name;
}

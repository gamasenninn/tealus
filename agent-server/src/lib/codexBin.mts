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

/**
 * `AGENT_CODEX_BIN` があればそれを、無ければ従来どおり PATH に任せる。
 * ★ 絶対パスを推奨 (PATH の解決順に依存しなくなる)。
 */
export function resolveCodexBin(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): string {
  const explicit = (env.AGENT_CODEX_BIN || '').trim();
  if (explicit) return explicit;
  return platform === 'win32' ? 'codex.cmd' : 'codex';
}

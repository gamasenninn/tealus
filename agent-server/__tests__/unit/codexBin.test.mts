/**
 * #423 どの codex を起動するかを、外から見える形にする。
 *
 * ★ 2026-09-06 に踏んだ形: グローバルの codex を alpha に上げても Deep が直らなかった。
 *   **agent-server は `npm start` で起動するので、PATH の先頭に `node_modules/.bin` が入る**。
 *   `@openai/codex-sdk` が連れてくる **ローカルの codex 0.128.0** が使われていた
 *   (グローバルは 0.154.0-alpha.3)。
 *
 * ★★ 一番の問題は「古い版が使われていたこと」ではなく、
 *   **どれが使われているかが外から見えなかったこと**。`codex --version` を手で叩いても、
 *   それは**手元の PATH の答え**であって、agent が起動するものとは限らない。
 *
 * → ★ 明示的に指定できるようにし (`AGENT_CODEX_BIN`)、★★ 起動時にログへ出す。
 */
const { resolveCodexBin } = require('../../src/lib/codexBin.mts') as {
  resolveCodexBin: (env?: Record<string, string | undefined>, platform?: string) => string;
};

describe('resolveCodexBin — どの codex を起動するか (#423)', () => {
  test('★★ AGENT_CODEX_BIN があれば、それを使う (絶対パス指定)', () => {
    const bin = 'C:/Users/user/AppData/Roaming/npm/codex.cmd';
    expect(resolveCodexBin({ AGENT_CODEX_BIN: bin }, 'win32')).toBe(bin);
  });

  test('★ 前後の空白は落とす (.env の書き間違いで動かないのを防ぐ)', () => {
    expect(resolveCodexBin({ AGENT_CODEX_BIN: '  /usr/local/bin/codex  ' }, 'linux')).toBe('/usr/local/bin/codex');
  });

  test('★ 空文字は「指定なし」として扱う', () => {
    expect(resolveCodexBin({ AGENT_CODEX_BIN: '   ' }, 'win32')).toBe('codex.cmd');
  });

  test('★ 指定が無ければ これまでどおり PATH に任せる (win32 は .cmd)', () => {
    expect(resolveCodexBin({}, 'win32')).toBe('codex.cmd');
    expect(resolveCodexBin({}, 'darwin')).toBe('codex');
  });
});

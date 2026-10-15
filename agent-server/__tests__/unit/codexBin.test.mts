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
  resolveCodexBin: (
    env?: Record<string, string | undefined>,
    platform?: string,
    opts?: { localBinDir?: string; exists?: (p: string) => boolean },
  ) => string;
};
const path = require('path') as typeof import('path');

// ★ 機械に依存させない: 手元に node_modules/.bin/codex があるかどうかで結果が変わらないよう、
//   「ある/無い」はテストが決める (docs/05 のテストの約束事)
const NONE = { localBinDir: '/app/agent-server/node_modules/.bin', exists: () => false };

describe('resolveCodexBin — どの codex を起動するか (#423)', () => {
  test('★★ AGENT_CODEX_BIN があれば、それを使う (絶対パス指定)', () => {
    const bin = 'C:/Users/user/AppData/Roaming/npm/codex.cmd';
    expect(resolveCodexBin({ AGENT_CODEX_BIN: bin }, 'win32', { ...NONE, exists: () => true })).toBe(bin);
  });

  test('★ 前後の空白は落とす (.env の書き間違いで動かないのを防ぐ)', () => {
    expect(resolveCodexBin({ AGENT_CODEX_BIN: '  /usr/local/bin/codex  ' }, 'linux')).toBe('/usr/local/bin/codex');
  });

  test('★ 空文字は「指定なし」として扱う', () => {
    expect(resolveCodexBin({ AGENT_CODEX_BIN: '   ' }, 'win32', NONE)).toBe('codex.cmd');
  });

  test('★ 指定が無く、手元にも無ければ PATH に任せる (win32 は .cmd)', () => {
    expect(resolveCodexBin({}, 'win32', NONE)).toBe('codex.cmd');
    expect(resolveCodexBin({}, 'darwin', NONE)).toBe('codex');
  });

  test('★★ 指定が無ければ agent-server 自身の node_modules/.bin の codex を先に使う (Light v2 と同じ版)', () => {
    // 2026-10-16: Docker の CMD は node 直起動で PATH に node_modules/.bin が入らず、Deep が codex を見つけなかった。
    //   本家は AGENT_CODEX_BIN でグローバル 0.154 を指し、Light v2 (SDK 同梱 0.162.1) と版が分かれていた
    const dir = '/app/agent-server/node_modules/.bin';
    const seen: string[] = [];
    const exists = (p: string) => { seen.push(p); return true; };
    expect(resolveCodexBin({}, 'linux', { localBinDir: dir, exists })).toBe(path.join(dir, 'codex'));
    expect(resolveCodexBin({}, 'win32', { localBinDir: dir, exists })).toBe(path.join(dir, 'codex.cmd'));
    expect(seen).toEqual([path.join(dir, 'codex'), path.join(dir, 'codex.cmd')]);
  });

  test('★ 既定の localBinDir はこのパッケージの node_modules/.bin', () => {
    const seen: string[] = [];
    resolveCodexBin({}, 'linux', { exists: (p) => { seen.push(p); return false; } });
    expect(seen[0]).toBe(path.join(__dirname, '..', '..', 'node_modules', '.bin', 'codex'));
  });
});

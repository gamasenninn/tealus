/**
 * 投稿を作る所 (`INSERT INTO messages`) の一覧を、docs/07 の表と照合する (#383 段階 0.5、2026-10-01)
 *
 * ★ なぜ要るか: 付随処理の付け忘れ 3 件は、どれも「経路が増えたときに、付随処理が一緒に増えていなかった」形だった。
 *   段階 0 のテスト (socket/postingPathSideEffects) は**今ある 18 本**を固定するが、**新しく足した経路は知らない**。
 *   ここで数を照合し、増えたら落として「表とテストに足す」を促す
 * ★ 照合は**ファイルごとの数**で行う。行番号は使わない (docs/07 の表が古くなった原因が行番号のずれだった)
 *
 * ★★ ここが落ちたら:
 *   1. docs/07 §2 の表に行を足し、付随処理 4 つの有無と理由 (意図 / 不明) を書く
 *   2. socket/postingPathSideEffects.test.mts に、その経路の it を足す
 *   3. 最後に、下の EXPECTED を直す (★ 1・2 を飛ばして数だけ直さない)
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '../../src');

/** docs/07 §2 の表と同じ 18 本。キーは src からの相対パス */
const EXPECTED: Record<string, number> = {
  'socket/handlers/message.mts': 1,  // #1
  'socket/handlers/call.mts': 1,     // #2
  'routes/media.mts': 2,             // #3 #4
  'routes/bot.mts': 2,               // #6 #7 (#5 は postAsUser、#12' は systemMessage)
  'routes/voice.mts': 1,             // #8
  'routes/messages.mts': 1,          // #9
  'routes/stamps.mts': 2,            // #10 #11
  'services/systemMessage.mts': 1,   // #12 #12'
  'services/lineMessageBridge.mts': 6, // #13〜#18
  'services/postAsUser.mts': 1,      // #5
};

function countInserts(): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!f.endsWith('.mts')) continue;
      const n = (fs.readFileSync(p, 'utf8').match(/INSERT INTO messages\b/g) ?? []).length;
      if (n > 0) out[path.relative(SRC, p).split(path.sep).join('/')] = n;
    }
  };
  walk(SRC);
  return out;
}

describe('投稿を作る所の一覧 (docs/07 §2)', () => {
  it('★ ファイルごとの数が表と一致する (増えたら docs/07 と段階 0 のテストに足すこと)', () => {
    expect(countInserts()).toEqual(EXPECTED);
  });

  it('合計は 18 本 (docs/07 §1)', () => {
    expect(Object.values(EXPECTED).reduce((a, b) => a + b, 0)).toBe(18);
  });
});

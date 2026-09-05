import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * #389 会話の逐語は 1 週間で消す。
 *
 * ★ 会話モードは「組織記憶に入れないための入口」で、会話はルームに 1 件も入らない
 *   (書かないことで捨てている)。**ところが計測ログには逐語が丸ごと残っていた** ——
 *   docs/08 §11 が名指しで警告していた形:
 *
 *   > 「捨てる」をどこまで本当に捨てるか。**「使い捨て」を名乗って実は残っていると、
 *   >  信頼を一度で失う。中途半端が一番悪い**
 *
 * ★ 保存期間は 1 週間 (利用者判断 2026-09-05)。測り直しには足り、溜め込みにはならない長さ。
 */
const { pruneVoiceChatLogs } = require('../../src/routes/voiceChat.mts') as {
  pruneVoiceChatLogs: (dir: string, maxAgeMs: number, now?: number) => number;
};

const WEEK = 7 * 24 * 60 * 60 * 1000;

function mkdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vc-prune-'));
}
function put(dir: string, name: string, ageMs: number): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, '{}\n');
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(p, t, t);
  return p;
}

describe('pruneVoiceChatLogs — 逐語を 1 週間で消す', () => {
  let dir: string;
  beforeEach(() => { dir = mkdir(); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('★ 1 週間より古いものは消す', () => {
    put(dir, 'old.jsonl', WEEK + 60_000);
    expect(pruneVoiceChatLogs(dir, WEEK)).toBe(1);
    expect(fs.existsSync(path.join(dir, 'old.jsonl'))).toBe(false);
  });

  test('★ 1 週間以内のものは残す (測り直しに使える長さ)', () => {
    put(dir, 'recent.jsonl', WEEK - 60_000);
    expect(pruneVoiceChatLogs(dir, WEEK)).toBe(0);
    expect(fs.existsSync(path.join(dir, 'recent.jsonl'))).toBe(true);
  });

  test('★ 古いものだけを選んで消す (新しいものを巻き込まない)', () => {
    put(dir, 'a.jsonl', WEEK * 2);
    put(dir, 'b.jsonl', WEEK * 3);
    put(dir, 'c.jsonl', 1000);
    expect(pruneVoiceChatLogs(dir, WEEK)).toBe(2);
    expect(fs.readdirSync(dir)).toEqual(['c.jsonl']);
  });

  test('★★ .jsonl 以外には触らない (同じ置き場に別のものが来ても壊さない)', () => {
    put(dir, 'old.jsonl', WEEK * 2);
    put(dir, 'notes.md', WEEK * 2);
    expect(pruneVoiceChatLogs(dir, WEEK)).toBe(1);
    expect(fs.existsSync(path.join(dir, 'notes.md'))).toBe(true);
  });

  test('ディレクトリが無ければ 0 を返す (初回起動で落ちない)', () => {
    expect(pruneVoiceChatLogs(path.join(dir, 'nope'), WEEK)).toBe(0);
  });

  test('★ 掃除が失敗しても投げない (会話を止めない)', () => {
    put(dir, 'x.jsonl', WEEK * 2);
    const spy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('EPERM'); });
    expect(() => pruneVoiceChatLogs(dir, WEEK)).not.toThrow();
    spy.mockRestore();
  });
});

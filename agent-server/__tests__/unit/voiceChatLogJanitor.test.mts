/**
 * 会話の逐語を 1 週間で消す約束 (#389、利用者判断) —— 会話モードが使われない間も守る (2026-09-27)
 *
 * ★ それまで: 掃除は `POST /voice-chat/log` (書き込み) のときにしか走らなかった (#407、
 *   「常駐のタイマーを増やさないため」= 実装の都合)。
 * ★★ 9/18 以降 会話モードが 1 度も使われず、**9/13 の逐語が 14 日残っていた** (12 ファイル)。
 *   docs/08 §11「使い捨てを名乗って実は残っていると、信頼を一度で失う」の形。
 * → 起動時に 1 回 + 動いている間は一定間隔で掃除する。タイマーは unref (終了を妨げない)。
 * ★★★ #407 の教訓: 関数とテストがあっても配線が無ければ動かない → 起動処理から呼ばれていることも見る。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

const { startVoiceLogJanitor } = require('../../src/routes/voiceChat.mts') as {
  startVoiceLogJanitor: (opts: { dir: string; intervalMs?: number; maxAgeMs?: number }) => () => void;
};

const DAY = 24 * 60 * 60 * 1000;

function put(dir: string, name: string, ageMs: number): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, '{}\n');
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(p, t, t);
  return p;
}

describe('startVoiceLogJanitor', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-janitor-')); });
  afterEach(() => { jest.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('★★ 起動した時点で 1 週間より古い逐語を消す (書き込みを待たない)', () => {
    const old = put(dir, 'old.jsonl', 14 * DAY);
    const recent = put(dir, 'recent.jsonl', 2 * DAY);
    const stop = startVoiceLogJanitor({ dir });
    try {
      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(recent)).toBe(true);
    } finally { stop(); }
  });

  test('★ 動いている間も一定間隔で消す', () => {
    jest.useFakeTimers({ doNotFake: ['Date'] });
    const stop = startVoiceLogJanitor({ dir, intervalMs: 1000 });
    try {
      const old = put(dir, 'later.jsonl', 8 * DAY);   // ★ 起動の後に期限切れになったもの
      jest.advanceTimersByTime(1000);
      expect(fs.existsSync(old)).toBe(false);
    } finally { stop(); }
  });

  test('置き場が無くても投げない', () => {
    const stop = startVoiceLogJanitor({ dir: path.join(dir, 'none') });
    stop();
  });

  test('★★★ 起動処理 (src/index.mts) から呼ばれている', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'index.mts'), 'utf8');
    expect(src).toMatch(/startVoiceLogJanitor\(/);
  });
});

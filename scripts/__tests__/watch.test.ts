/**
 * ファイル監視ロジックのテスト
 * TDD Red phase
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { waitForFileComplete, watchDirectory, sendWithRetry, createWatchSender, getUnsent, writeLastSent, heartbeatInfo } from '../watch.ts';

// テスト用一時ディレクトリ
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tealus-watch-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('waitForFileComplete', () => {
  test('書き込み済みファイルは即座に完了と判定', async () => {
    const filePath = path.join(tmpDir, 'complete.wav');
    fs.writeFileSync(filePath, Buffer.alloc(1024)); // 1KB
    const result = await waitForFileComplete(filePath, { interval: 100, stableCount: 2, timeout: 5000 });
    expect(result).toBe(true);
  });

  test('サイズ0のファイルは完了待ち後タイムアウト', async () => {
    const filePath = path.join(tmpDir, 'empty.wav');
    fs.writeFileSync(filePath, Buffer.alloc(0));
    const result = await waitForFileComplete(filePath, { interval: 100, stableCount: 2, timeout: 500 });
    expect(result).toBe(false);
  });

  test('書き込み中のファイルはサイズ安定後に完了', async () => {
    const filePath = path.join(tmpDir, 'writing.wav');
    fs.writeFileSync(filePath, Buffer.alloc(100));

    // 200ms後に追記を止める（サイズが安定する）
    const appendInterval = setInterval(() => {
      try { fs.appendFileSync(filePath, Buffer.alloc(50)); } catch {}
    }, 50);
    setTimeout(() => clearInterval(appendInterval), 200);

    const result = await waitForFileComplete(filePath, { interval: 100, stableCount: 2, timeout: 5000 });
    expect(result).toBe(true);
  });

  test('存在しないファイルはfalseを返す', async () => {
    const result = await waitForFileComplete('/nonexistent/file.wav', { interval: 100, stableCount: 2, timeout: 500 });
    expect(result).toBe(false);
  });
});

describe('watchDirectory', () => {
  test('新規ファイル作成を検知してコールバックを呼ぶ', (done) => {
    const detected: string[] = [];

    const stop = watchDirectory(tmpDir, ['.wav'], (filePath) => {
      detected.push(path.basename(filePath));
      if (detected.length === 1) {
        stop();
        expect(detected).toContain('test.wav');
        done();
      }
    });

    // 少し待ってからファイルを作成
    setTimeout(() => {
      fs.writeFileSync(path.join(tmpDir, 'test.wav'), Buffer.alloc(1024));
    }, 200);
  }, 10000);

  test('対象外の拡張子は無視する', (done) => {
    const detected: string[] = [];

    const stop = watchDirectory(tmpDir, ['.wav'], (filePath) => {
      detected.push(path.basename(filePath));
    });

    // .txt を作成（無視されるはず）→ .wav を作成
    setTimeout(() => {
      fs.writeFileSync(path.join(tmpDir, 'ignore.txt'), Buffer.alloc(100));
    }, 200);

    setTimeout(() => {
      fs.writeFileSync(path.join(tmpDir, 'detect.wav'), Buffer.alloc(1024));
    }, 400);

    setTimeout(() => {
      stop();
      expect(detected).toContain('detect.wav');
      expect(detected).not.toContain('ignore.txt');
      done();
    }, 2000);
  }, 10000);

  test('複数の拡張子を監視できる', (done) => {
    const detected: string[] = [];

    const stop = watchDirectory(tmpDir, ['.wav', '.mp4'], (filePath) => {
      detected.push(path.basename(filePath));
    });

    setTimeout(() => {
      fs.writeFileSync(path.join(tmpDir, 'a.wav'), Buffer.alloc(1024));
    }, 200);

    setTimeout(() => {
      fs.writeFileSync(path.join(tmpDir, 'b.mp4'), Buffer.alloc(1024));
    }, 400);

    setTimeout(() => {
      stop();
      expect(detected).toContain('a.wav');
      expect(detected).toContain('b.mp4');
      done();
    }, 2000);
  }, 10000);

  test('起動前から存在するファイルは検知しない', (done) => {
    // 先にファイルを作成
    fs.writeFileSync(path.join(tmpDir, 'existing.wav'), Buffer.alloc(1024));

    const detected: string[] = [];
    const stop = watchDirectory(tmpDir, ['.wav'], (filePath) => {
      detected.push(path.basename(filePath));
    });

    // 既存ファイルを読み取り（atime更新をシミュレート）
    setTimeout(() => {
      fs.readFileSync(path.join(tmpDir, 'existing.wav'));
    }, 200);

    // 新規ファイルは検知されるはず
    setTimeout(() => {
      fs.writeFileSync(path.join(tmpDir, 'new.wav'), Buffer.alloc(1024));
    }, 400);

    setTimeout(() => {
      stop();
      expect(detected).not.toContain('existing.wav');
      expect(detected).toContain('new.wav');
      done();
    }, 2000);
  }, 10000);

  test('同一ファイルの重複イベントはデバウンスされる', (done) => {
    const detected: string[] = [];

    const stop = watchDirectory(tmpDir, ['.wav'], (filePath) => {
      detected.push(path.basename(filePath));
    });

    // 同じファイルを短時間で複数回書き込み
    setTimeout(() => {
      fs.writeFileSync(path.join(tmpDir, 'dup.wav'), Buffer.alloc(512));
    }, 200);
    setTimeout(() => {
      fs.appendFileSync(path.join(tmpDir, 'dup.wav'), Buffer.alloc(512));
    }, 300);

    setTimeout(() => {
      stop();
      const dupCount = detected.filter(f => f === 'dup.wav').length;
      expect(dupCount).toBe(1);
      done();
    }, 3000);
  }, 10000);
});


// ★ #578 無線の送り込みは、本体の再起動中に送ると落ちて黙っていた (10-02 に 4 時間 6 分)。
//   送り直しを入れ、どんな失敗でもプロセスを落とさない
describe('★ #578 sendWithRetry', () => {
  const noSleep = async () => {};
  test('★ 失敗しても間を空けて送り直し、届いたら true', async () => {
    const results = [false, false, true];
    const attempt = jest.fn(async () => results.shift()!);
    expect(await sendWithRetry(attempt, [1, 1, 1], noSleep)).toBe(true);
    expect(attempt).toHaveBeenCalledTimes(3);
  });
  test('★ 例外 (つながらない) でも落ちずに送り直す', async () => {
    let n = 0;
    const attempt = jest.fn(async () => { n += 1; if (n < 2) throw new Error('connect ECONNREFUSED'); return true; });
    expect(await sendWithRetry(attempt, [1, 1], noSleep)).toBe(true);
  });
  test('★ 送り直しを使い切ったら false (例外は投げない)', async () => {
    const attempt = jest.fn(async () => { throw new Error('down'); });
    expect(await sendWithRetry(attempt, [1, 1], noSleep)).toBe(false);
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});

describe('★ #578 watchDirectory は callback の失敗でプロセスを落とさない', () => {
  test('★ callback が reject しても次のファイルを検知する', (done) => {
    const detected: string[] = [];
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stop = watchDirectory(tmpDir, ['.wav'], async (filePath) => {
      detected.push(path.basename(filePath));
      if (detected.length === 1) throw new Error('send failed');
      stop();
      err.mockRestore();
      expect(detected).toEqual(['a.wav', 'b.wav']);
      done();
    });
    setTimeout(() => fs.writeFileSync(path.join(tmpDir, 'a.wav'), Buffer.alloc(16)), 200);
    setTimeout(() => fs.writeFileSync(path.join(tmpDir, 'b.wav'), Buffer.alloc(16)), 2600);
  }, 10000);
});

describe('★ #582 createWatchSender (監視中の送信を順番に、送れなかったものを覚えておく)', () => {
  // retry は送り直しを省いた 1 回きりの送信 (sendWithRetry の中身は上で試している)
  const once = async (attempt: () => Promise<boolean>) => { try { return await attempt(); } catch { return false; } };
  const quiet = () => jest.spyOn(console, 'error').mockImplementation(() => {});

  test('★ 1 本ずつ順番に送る (先の送信が終わるまで次を始めない)', async () => {
    const log: string[] = [];
    let releaseA!: () => void;
    const send = jest.fn(async (f: string) => {
      log.push(`start ${f}`);
      if (f === 'a') await new Promise<void>((r) => { releaseA = r; });
      log.push(`end ${f}`);
      return true;
    });
    const enqueue = createWatchSender({ send, onAllSent: () => {}, retry: once });
    const pa = enqueue('a');
    const pb = enqueue('b');
    await new Promise((r) => setTimeout(r, 20));
    expect(log).toEqual(['start a']);
    releaseA();
    await Promise.all([pa, pb]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  test('★ 先の録音が送れず後の録音が届いても、「最後に送った時刻」を進めない', async () => {
    const err = quiet();
    const onAllSent = jest.fn();
    const send = jest.fn(async (f: string) => f !== 'a');
    const enqueue = createWatchSender({ send, onAllSent, retry: once });
    expect(await enqueue('a')).toBe(false);
    expect(await enqueue('b')).toBe(true);
    expect(onAllSent).not.toHaveBeenCalled();
    err.mockRestore();
  });

  test('★ 送れなかった録音は、次の録音の前に送り直す。全部届いたら進める', async () => {
    const err = quiet();
    const onAllSent = jest.fn();
    let down = true;
    const sent: string[] = [];
    const send = jest.fn(async (f: string) => { if (down) return false; sent.push(f); return true; });
    const enqueue = createWatchSender({ send, onAllSent, retry: once });
    await enqueue('a');              // 本体が止まっている
    down = false;
    await enqueue('b');              // 戻った → a を先に送ってから b
    expect(sent).toEqual(['a', 'b']);
    expect(onAllSent).toHaveBeenCalledTimes(1);
    expect(onAllSent).toHaveBeenCalledWith('b');
    err.mockRestore();
  });

  test('全部届いていれば、届くたびに進める', async () => {
    const onAllSent = jest.fn();
    const enqueue = createWatchSender({ send: async () => true, onAllSent, retry: once });
    await enqueue('a');
    await enqueue('b');
    expect(onAllSent.mock.calls).toEqual([['a'], ['b']]);
  });

  test('★ 送信や記録が例外を投げても、列は止まらない', async () => {
    const err = quiet();
    const onAllSent = jest.fn(() => { throw new Error('disk full'); });
    const enqueue = createWatchSender({ send: async () => true, onAllSent, retry: once });
    await enqueue('a');
    expect(await enqueue('b')).toBe(true);
    err.mockRestore();
  });
});

describe('★ #587 getUnsent はファイル時刻の 1 ミリ秒未満の端数で「未送信」にしない', () => {
  test('★ 最後に送った録音の mtime (端数つき) を .last_sent に書いたら、その録音は未送信に戻らない', () => {
    const f = path.join(tmpDir, 'rec.wav');
    fs.writeFileSync(f, Buffer.alloc(16));
    const t = new Date('2026-10-12T05:34:56.087Z').getTime() / 1000 + 0.0007883; // 秒 (端数つき)
    fs.utimesSync(f, t, t);
    const mtimeMs = fs.statSync(f).mtimeMs;
    writeLastSent(tmpDir, new Date(mtimeMs));             // tealus-cli と同じ書き方 (ミリ秒で切れる)
    expect(getUnsent(tmpDir, ['.wav'])).toEqual([]);
  });

  test('1 ミリ秒でも新しい録音は未送信として返す', () => {
    writeLastSent(tmpDir, new Date('2026-10-12T05:34:56.087Z'));
    const f = path.join(tmpDir, 'next.wav');
    fs.writeFileSync(f, Buffer.alloc(16));
    const t = new Date('2026-10-12T05:34:56.088Z').getTime() / 1000;
    fs.utimesSync(f, t, t);
    expect(getUnsent(tmpDir, ['.wav']).map((u) => path.basename(u.path))).toEqual(['next.wav']);
  });
});

describe('★ #595 heartbeatInfo — 鼓動に添える「最新のファイル」と「最後に送った時刻」', () => {
  const at = (iso: string, f: string) => { const t = new Date(iso).getTime() / 1000; fs.utimesSync(f, t, t); };

  test('対象の拡張子でいちばん新しいファイルの時刻と、.last_sent を ISO で返す', () => {
    const a = path.join(tmpDir, 'a.wav'); fs.writeFileSync(a, 'x'); at('2026-10-13T03:00:00.000Z', a);
    const b = path.join(tmpDir, 'b.wav'); fs.writeFileSync(b, 'x'); at('2026-10-13T03:10:00.000Z', b);
    const c = path.join(tmpDir, 'c.srt'); fs.writeFileSync(c, 'x'); at('2026-10-13T04:00:00.000Z', c); // 対象外
    writeLastSent(tmpDir, new Date('2026-10-13T03:00:00.000Z'));
    expect(heartbeatInfo(tmpDir, ['.wav'])).toEqual({
      latest_file_at: '2026-10-13T03:10:00.000Z',
      last_sent_at: '2026-10-13T03:00:00.000Z',
    });
  });

  test('ファイルも .last_sent も無ければ null (★ 例外を投げない)', () => {
    expect(heartbeatInfo(tmpDir, ['.wav'])).toEqual({ latest_file_at: null, last_sent_at: null });
    expect(heartbeatInfo(path.join(tmpDir, 'no-such'), ['.wav'])).toEqual({ latest_file_at: null, last_sent_at: null });
  });
});

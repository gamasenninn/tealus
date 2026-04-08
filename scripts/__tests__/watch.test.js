/**
 * ファイル監視ロジックのテスト
 * TDD Red phase
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { waitForFileComplete, watchDirectory } = require('../watch');

// テスト用一時ディレクトリ
let tmpDir;

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
      try { fs.appendFileSync(filePath, Buffer.alloc(50)); } catch(e) {}
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
    const detected = [];

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
    const detected = [];

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
    const detected = [];

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

    const detected = [];
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
    const detected = [];

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

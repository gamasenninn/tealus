/**
 * ファイルメモリ ラッパーのテスト
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const { readMemory, writeMemory, loadMemoryForPrompt } = require('../../src/memory/fileMemory');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tealus-memory-test-'));
  fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('fileMemory', () => {
  test('MEMORY.md がない場合は空文字を返す', () => {
    const result = readMemory(tmpDir);
    expect(result).toBe('');
  });

  test('MEMORY.md を読み込む', () => {
    fs.writeFileSync(path.join(tmpDir, 'memory', 'MEMORY.md'), '## Memory Index\n- [user.md](user.md) — ユーザー情報');
    const result = readMemory(tmpDir);
    expect(result).toContain('Memory Index');
  });

  test('メモリファイルに書き込む', () => {
    writeMemory(tmpDir, 'user_tanaka', 'type: user\n\n田中さんは営業部');
    const filePath = path.join(tmpDir, 'memory', 'user_tanaka.md');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toContain('田中さんは営業部');
  });

  test('loadMemoryForPrompt はインデックスと関連ファイルを結合する', () => {
    fs.writeFileSync(path.join(tmpDir, 'memory', 'MEMORY.md'), '## Memory Index\n- [info.md](info.md) — 基本情報');
    fs.writeFileSync(path.join(tmpDir, 'memory', 'info.md'), '営業部の田中です');

    const result = loadMemoryForPrompt(tmpDir);
    expect(result).toContain('Memory Index');
    expect(result).toContain('営業部の田中です');
  });
});

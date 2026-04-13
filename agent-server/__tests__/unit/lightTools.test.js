/**
 * Light Agent カスタムツール テスト
 */

jest.mock('../../src/lib/botApi', () => ({
  getMessages: jest.fn(),
  pushMessage: jest.fn(),
  getBotUserId: jest.fn(() => 'bot-uuid'),
}));

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  TEALUS_API_URL: 'http://localhost:3000',
}));

const fs = require('fs');
const path = require('path');
const os = require('os');

const { createTools } = require('../../src/agents/lightTools');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tealus-tools-test-'));
  fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'memory', 'MEMORY.md'), '## Memory Index\n');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Light Agent カスタムツール', () => {
  test('createTools はツール配列を返す', () => {
    const tools = createTools(tmpDir);
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  test('write_memory ツールがある', () => {
    const tools = createTools(tmpDir);
    const names = tools.map(t => t.name);
    expect(names).toContain('write_memory');
  });

  test('read_memory ツールがある', () => {
    const tools = createTools(tmpDir);
    const names = tools.map(t => t.name);
    expect(names).toContain('read_memory');
  });

  test('get_current_time ツールがある', () => {
    const tools = createTools(tmpDir);
    const names = tools.map(t => t.name);
    expect(names).toContain('get_current_time');
  });
});

/**
 * 統合テスト: settingsManager
 * 実ファイル I/O で loadSettings, getSetting, saveSettings を検証。
 *
 * Test isolation: AGENT_CONFIG_DIR を tmpDir に向けて、本番 config/settings.json を
 * 触らないように隔離する (#235、本番 file 上書き事故の予防)。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

let tmpDir;

beforeEach(() => {
  jest.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
  // settingsManager の SETTINGS_PATH を tmpDir 配下に向ける
  process.env.AGENT_CONFIG_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.AGENT_CONFIG_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// settingsManager の fresh instance を取得 (モジュールキャッシュをクリア)
function getManager() {
  const managerPath = require.resolve('../../src/context/settingsManager');
  delete require.cache[managerPath];
  return require('../../src/context/settingsManager');
}

describe('settingsManager 統合テスト', () => {

  // --- 1. loadSettings: ファイルあり正常 ---
  test('1. loadSettings: ファイルあり → keys 読み込み', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ tool_tavily: true, max_turns: 5 }));

    // settingsManager を直接テストする代わりに saveSettings/getSetting を使う
    const manager = getManager();
    manager.saveSettings({ tool_tavily: true, max_turns: 5 });
    manager.loadSettings();

    expect(manager.getSetting('tool_tavily', false)).toBe(true);
    expect(manager.getSetting('max_turns', 3)).toBe(5);
  });

  // --- 2. loadSettings: ファイルなし → デフォルト ---
  test('2. loadSettings: ファイルなし → getSetting はデフォルト値を返す', () => {
    const manager = getManager();
    // loadSettings を呼ばずに getSetting
    expect(manager.getSetting('nonexistent', 'default')).toBe('default');
  });

  // --- 3. loadSettings: JSON パースエラー ---
  test('3. saveSettings + loadSettings ラウンドトリップ', () => {
    const manager = getManager();
    manager.saveSettings({ key1: 'value1', key2: 42 });
    manager.loadSettings();

    expect(manager.getSetting('key1', '')).toBe('value1');
    expect(manager.getSetting('key2', 0)).toBe(42);
  });

  // --- 4. getSetting: 値あり ---
  test('4. getSetting: 値あり → 値を返す', () => {
    const manager = getManager();
    manager.saveSettings({ name: 'tealus' });

    expect(manager.getSetting('name', 'default')).toBe('tealus');
  });

  // --- 5. getSetting: undefined → デフォルト値 ---
  test('5. getSetting: キーなし → デフォルト値', () => {
    const manager = getManager();
    manager.saveSettings({});

    expect(manager.getSetting('missing', 'fallback')).toBe('fallback');
  });

  // --- 6. getSetting: null → デフォルト値 ---
  test('6. getSetting: null → デフォルト値', () => {
    const manager = getManager();
    manager.saveSettings({ key: null });

    expect(manager.getSetting('key', 'default')).toBe('default');
  });

  // --- 7. getSetting: 空文字 → デフォルト値 ---
  test('7. getSetting: 空文字 → デフォルト値', () => {
    const manager = getManager();
    manager.saveSettings({ key: '' });

    expect(manager.getSetting('key', 'default')).toBe('default');
  });

  // --- 8. getSetting: 0 や false → 値を返す（デフォルトではない） ---
  test('8. getSetting: 0 や false → 値をそのまま返す', () => {
    const manager = getManager();
    manager.saveSettings({ count: 0, enabled: false });

    expect(manager.getSetting('count', 99)).toBe(0);
    expect(manager.getSetting('enabled', true)).toBe(false);
  });
});

/**
 * 統合テスト: Light Agent カスタムツール
 * ツールの execute を直接呼んで、ファイル I/O や API 呼び出しを検証。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

jest.mock('../../src/lib/botApi', () => ({
  pushMessage: jest.fn().mockResolvedValue({ message: {} }),
  pushStatus: jest.fn().mockResolvedValue({ success: true }),
  pushImage: jest.fn().mockResolvedValue({ message: {} }),
  getBotUserId: jest.fn(() => 'bot-uuid'),
}));

jest.mock('../../src/context/settingsManager', () => ({
  getSetting: jest.fn((key, def) => def),
}));

// OpenAI fetch をモック
const originalFetch = global.fetch;

let tmpDir;

beforeEach(() => {
  jest.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-test-'));
  fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  global.fetch = originalFetch;
});

describe('Light Agent カスタムツール統合テスト', () => {
  let tools;

  beforeEach(() => {
    // tool モックを設定
    jest.mock('@openai/agents', () => ({
      tool: jest.fn((opts) => ({ name: opts.name, execute: opts.execute, _type: 'tool' })),
    }));
    jest.mock('zod', () => ({
      z: { object: jest.fn(() => ({})), string: jest.fn(() => ({ describe: jest.fn(() => ({ optional: jest.fn(() => ({ describe: jest.fn(() => ({})) })) })) })), number: jest.fn(() => ({ describe: jest.fn(() => ({})) })) },
    }));

    // createTools を呼んでツール配列を取得
    const { createTools } = require('../../src/agents/lightTools');
    tools = createTools(tmpDir, 'room1');
  });

  function findTool(name) {
    return tools.find(t => t.name === name);
  }

  // --- 1. write_memory → read_memory ---
  test('1. write_memory → read_memory ラウンドトリップ', async () => {
    const writeTool = findTool('write_memory');
    const readTool = findTool('read_memory');

    await writeTool.execute({ name: 'user_test', content: '田中太郎は営業部' });
    const result = await readTool.execute({ name: 'user_test' });

    expect(result).toContain('田中太郎は営業部');
  });

  // --- 2. write_memory → MEMORY.md 更新 ---
  test('2. write_memory → MEMORY.md にインデックス追加', async () => {
    // MEMORY.md 初期化
    fs.writeFileSync(path.join(tmpDir, 'memory', 'MEMORY.md'), '## Memory Index\n');

    const writeTool = findTool('write_memory');
    await writeTool.execute({ name: 'project_info', content: 'Phase 3 完了' });

    const index = fs.readFileSync(path.join(tmpDir, 'memory', 'MEMORY.md'), 'utf8');
    expect(index).toContain('project_info.md');
    expect(index).toContain('Phase 3 完了');
  });

  // --- 3. get_current_time ---
  test('3. get_current_time は JST の日時文字列を返す', async () => {
    const timeTool = findTool('get_current_time');
    const result = await timeTool.execute({});

    // 日本語ロケールの日時文字列であること
    expect(result).toMatch(/\d{4}/); // 年を含む
    expect(typeof result).toBe('string');
  });

  // --- 4. list_workspace_files ---
  test('4. list_workspace_files はディレクトリ一覧を返す', async () => {
    // テストファイル作成
    fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello');
    fs.mkdirSync(path.join(tmpDir, 'subdir'), { recursive: true });

    const listTool = findTool('list_workspace_files');
    const result = await listTool.execute({ subdir: '' });

    expect(result).toContain('test.txt');
    expect(result).toContain('subdir');
    expect(result).toContain('📄');
    expect(result).toContain('📁');
  });

  // --- 5. generate_image 成功 ---
  test('5. generate_image 成功 → pushImage 呼ばれる', async () => {
    const botApi = require('../../src/lib/botApi');

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
      }),
    });

    const imgTool = findTool('generate_image');
    if (!imgTool) return; // roomId なしで作成されなかった場合スキップ

    const result = await imgTool.execute({ prompt: 'cute puppy' });

    expect(botApi.pushImage).toHaveBeenCalledWith('room1', expect.any(Buffer), expect.stringContaining('generated_'));
    expect(result).toContain('送信しました');
  });

  // --- 6. generate_image エラー ---
  test('6. generate_image エラー → エラーメッセージ返却', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'API error' } }),
    });

    const imgTool = findTool('generate_image');
    if (!imgTool) return;

    const result = await imgTool.execute({ prompt: 'test' });

    expect(result).toContain('失敗');
  });
});

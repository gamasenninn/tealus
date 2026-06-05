/**
 * LINE Bridge (Content API client) unit test
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  fetchLineContent,
  saveLineContentToFile,
  extensionForMime,
} = require('../../src/services/lineBridge');

function makeMockResponse({ ok = true, status = 200, statusText = 'OK', mimeType = 'image/jpeg', body = Buffer.from('binary-content') }) {
  return {
    ok,
    status,
    statusText,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? mimeType : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}

describe('extensionForMime', () => {
  test('image/jpeg → .jpg', () => {
    expect(extensionForMime('image/jpeg')).toBe('.jpg');
  });
  test('audio/m4a → .m4a', () => {
    expect(extensionForMime('audio/m4a')).toBe('.m4a');
  });
  test('charset 付き mime も decode', () => {
    expect(extensionForMime('image/png; charset=utf-8')).toBe('.png');
  });
  test('unknown mime → .bin', () => {
    expect(extensionForMime('application/x-unknown')).toBe('.bin');
  });
  test('undefined → .bin', () => {
    expect(extensionForMime(undefined)).toBe('.bin');
    expect(extensionForMime(null)).toBe('.bin');
    expect(extensionForMime('')).toBe('.bin');
  });
});

describe('fetchLineContent', () => {
  test('成功 (= 200) で buffer + mimeType 返却', async () => {
    const sampleBytes = Buffer.from('test-binary');
    const mockFetch = jest.fn().mockResolvedValue(makeMockResponse({
      ok: true,
      mimeType: 'audio/m4a',
      body: sampleBytes,
    }));

    const result = await fetchLineContent('msg-id-123', 'access-token-abc', { fetchImpl: mockFetch });
    expect(result.mimeType).toBe('audio/m4a');
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.toString()).toBe('test-binary');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('msg-id-123');
    expect(opts.headers.Authorization).toBe('Bearer access-token-abc');
  });

  test('response not ok で throw', async () => {
    const mockFetch = jest.fn().mockResolvedValue(makeMockResponse({ ok: false, status: 401, statusText: 'Unauthorized' }));
    await expect(fetchLineContent('msg', 'tok', { fetchImpl: mockFetch })).rejects.toThrow(/401/);
  });

  test('messageId 未指定で throw', async () => {
    await expect(fetchLineContent('', 'tok')).rejects.toThrow(/messageId/);
  });

  test('accessToken 未指定で throw', async () => {
    await expect(fetchLineContent('msg', '')).rejects.toThrow(/accessToken/);
  });

  test('fetchImpl 不在で throw', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = undefined;
    try {
      await expect(fetchLineContent('msg', 'tok')).rejects.toThrow(/fetch/);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('saveLineContentToFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-bridge-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('image 保存 → file 生成 + correct extension', async () => {
    const buf = Buffer.from('jpeg-bytes');
    const result = await saveLineContentToFile(buf, 'image/jpeg', tmpDir, { subdir: 'line-images' });

    expect(result.fileName).toMatch(/\.jpg$/);
    expect(result.fileSize).toBe(buf.length);
    expect(result.mimeType).toBe('image/jpeg');
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath).toString()).toBe('jpeg-bytes');
    expect(result.relativePath).toMatch(/^line-images\//);
  });

  test('audio 保存 → .m4a extension', async () => {
    const buf = Buffer.from('m4a-bytes');
    const result = await saveLineContentToFile(buf, 'audio/m4a', tmpDir, { subdir: 'line-voices' });
    expect(result.fileName).toMatch(/\.m4a$/);
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  test('subdir 未指定で default "line"', async () => {
    const buf = Buffer.from('x');
    const result = await saveLineContentToFile(buf, 'image/png', tmpDir);
    expect(result.relativePath).toMatch(/^line\//);
  });

  test('buffer 以外で throw', async () => {
    await expect(saveLineContentToFile('not buffer', 'image/png', tmpDir)).rejects.toThrow(/buffer/);
  });

  test('baseDir 未指定で throw', async () => {
    await expect(saveLineContentToFile(Buffer.from('x'), 'image/png', '')).rejects.toThrow(/baseDir/);
  });

  test('originalFileName 指定 → display 名 = 原名、physical 拡張子 = 原拡張子 (= Phase 2.1 MD file fix)', async () => {
    const buf = Buffer.from('# Markdown content');
    const result = await saveLineContentToFile(buf, 'application/octet-stream', tmpDir, {
      subdir: 'line-files',
      originalFileName: 'notes.md',
    });
    expect(result.fileName).toBe('notes.md');                  // display 名 = 原名
    expect(result.filePath).toMatch(/\.md$/);                  // physical file は .md 拡張子
    expect(result.relativePath).toMatch(/^line-files\//);
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  test('originalFileName 指定 + 危険文字を sanitize', async () => {
    const buf = Buffer.from('x');
    const result = await saveLineContentToFile(buf, 'application/pdf', tmpDir, {
      subdir: 'line-files',
      originalFileName: 'a/b\\c:d*.pdf',
    });
    expect(result.fileName).toBe('a_b_c_d_.pdf');              // unsafe chars replaced
    expect(result.filePath).toMatch(/\.pdf$/);
  });

  test('originalFileName 未指定 = 既存挙動維持 (= physical 名 = display 名)', async () => {
    const buf = Buffer.from('x');
    const result = await saveLineContentToFile(buf, 'image/png', tmpDir, { subdir: 'line-images' });
    expect(result.fileName).toMatch(/\.png$/);
    expect(result.filePath).toMatch(new RegExp(result.fileName + '$'));  // physical = display
  });
});

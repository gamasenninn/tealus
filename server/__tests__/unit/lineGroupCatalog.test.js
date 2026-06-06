/**
 * lineGroupCatalog unit test (= Phase 2.3、6/6 Day 21 確立)
 *
 * webhook 受信時の auto-discover + LINE API getGroupSummary + atomic write の挙動を verify。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const {
  readCatalog,
  writeCatalogAtomic,
  fetchGroupSummary,
  upsertGroupEntry,
  LINE_GROUP_SUMMARY_BASE,
  MAX_SNIPPET_CHARS,
} = require('../../src/services/lineGroupCatalog');

let tmpDir;
let tmpFile;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-catalog-test-'));
  tmpFile = path.join(tmpDir, 'catalog.json');
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('readCatalog', () => {
  test('file 存在 → JSON parse 結果返す', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ g1: { name: 'g one' } }));
    expect(readCatalog(tmpFile)).toEqual({ g1: { name: 'g one' } });
  });

  test('file なし → 空 object (= ENOENT silent)', () => {
    expect(readCatalog('/nonexistent/file.json')).toEqual({});
  });

  test('parse error → 空 object + warn silent', () => {
    fs.writeFileSync(tmpFile, 'not json {{{');
    expect(readCatalog(tmpFile)).toEqual({});
  });
});

describe('writeCatalogAtomic', () => {
  test('atomic write (= temp + rename) で file 生成', () => {
    writeCatalogAtomic(tmpFile, { g1: { name: 'test' } });
    const content = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(content).toEqual({ g1: { name: 'test' } });
  });

  test('parent dir 自動作成', () => {
    const nestedPath = path.join(tmpDir, 'nested/dir/catalog.json');
    writeCatalogAtomic(nestedPath, { g1: { name: 'x' } });
    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  test('既存 file 上書き', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ old: 'data' }));
    writeCatalogAtomic(tmpFile, { new: 'data' });
    expect(JSON.parse(fs.readFileSync(tmpFile, 'utf8'))).toEqual({ new: 'data' });
  });
});

describe('fetchGroupSummary', () => {
  test('LINE API URL に Bearer Auth で GET、groupName 返す', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ groupId: 'C123', groupName: '営業部', pictureUrl: 'https://...' }),
    });
    const result = await fetchGroupSummary('C123', 'token-xyz', { fetchImpl: fetchMock });
    expect(result).toEqual({ groupName: '営業部', pictureUrl: 'https://...' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${LINE_GROUP_SUMMARY_BASE}/C123/summary`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-xyz' }),
      })
    );
  });

  test('non-ok response → throw', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });
    await expect(fetchGroupSummary('C123', 'tok', { fetchImpl: fetchMock })).rejects.toThrow(/403/);
  });

  test('groupId / accessToken 未指定で throw', async () => {
    await expect(fetchGroupSummary('', 'tok')).rejects.toThrow(/groupId/);
    await expect(fetchGroupSummary('C', '')).rejects.toThrow(/accessToken/);
  });
});

describe('upsertGroupEntry', () => {
  test('new group → LINE API getGroupSummary call + entry 作成 + name 設定', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ groupName: '新 group' }),
    });

    const result = await upsertGroupEntry('C123', {
      sender: '山田',
      snippet: 'hello',
      timestamp: '2026-06-06T10:00:00Z',
    }, { filePath: tmpFile, accessToken: 'tok', fetchImpl: fetchMock });

    expect(result).toEqual({ updated: true, fetchedName: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const catalog = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(catalog.C123).toEqual({
      name: '新 group',
      last_seen_at: '2026-06-06T10:00:00Z',
      last_sender: '山田',
      last_message_snippet: 'hello',
      first_seen_at: '2026-06-06T10:00:00Z',
    });
  });

  test('existing group (= name 既取得) → API call skip + last_seen_at / sender / snippet のみ update', async () => {
    fs.writeFileSync(tmpFile, JSON.stringify({
      C123: {
        name: '既存 name',
        last_seen_at: '2026-06-04T00:00:00Z',
        last_sender: 'old',
        last_message_snippet: 'old',
        first_seen_at: '2026-06-04T00:00:00Z',
      },
    }));
    const fetchMock = jest.fn();

    const result = await upsertGroupEntry('C123', {
      sender: '新 sender',
      snippet: '新 snippet',
      timestamp: '2026-06-06T10:00:00Z',
    }, { filePath: tmpFile, accessToken: 'tok', fetchImpl: fetchMock });

    expect(result).toEqual({ updated: true, fetchedName: false });
    expect(fetchMock).not.toHaveBeenCalled();  // ★ API call skip

    const catalog = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(catalog.C123.name).toBe('既存 name');  // name は 保持
    expect(catalog.C123.last_seen_at).toBe('2026-06-06T10:00:00Z');
    expect(catalog.C123.last_sender).toBe('新 sender');
    expect(catalog.C123.last_message_snippet).toBe('新 snippet');
    expect(catalog.C123.first_seen_at).toBe('2026-06-04T00:00:00Z');  // first_seen_at は keep
  });

  test('API fail → silent + entry name=null で書き出し (= 次回 retry)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'fail' });
    const result = await upsertGroupEntry('C123', { snippet: 'x' }, {
      filePath: tmpFile, accessToken: 'tok', fetchImpl: fetchMock,
    });
    expect(result.updated).toBe(true);
    expect(result.fetchedName).toBe(false);
    const catalog = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(catalog.C123.name).toBeNull();
  });

  test('accessToken なし → API call skip (= name null のまま entry 作成)', async () => {
    const result = await upsertGroupEntry('C123', { snippet: 'x' }, {
      filePath: tmpFile,
      accessToken: '',
    });
    expect(result.updated).toBe(true);
    expect(result.fetchedName).toBe(false);
    const catalog = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(catalog.C123.name).toBeNull();
  });

  test('snippet は MAX_SNIPPET_CHARS で truncate', async () => {
    const longText = 'あ'.repeat(200);  // 200 chars
    await upsertGroupEntry('C123', { snippet: longText }, {
      filePath: tmpFile, accessToken: '',
    });
    const catalog = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(catalog.C123.last_message_snippet.length).toBe(MAX_SNIPPET_CHARS);
  });

  test('既存 entry + meta key (= _comment) 保持', async () => {
    fs.writeFileSync(tmpFile, JSON.stringify({
      _comment: 'user notes',
      C123: { name: 'g', last_seen_at: '2026-01-01T00:00:00Z' },
    }));
    await upsertGroupEntry('C123', { snippet: 'x' }, {
      filePath: tmpFile, accessToken: '',
    });
    const catalog = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(catalog._comment).toBe('user notes');  // ★ user 注記 preserve
  });

  test('groupId 未指定で throw', async () => {
    await expect(upsertGroupEntry('', { snippet: 'x' })).rejects.toThrow(/groupId/);
  });
});

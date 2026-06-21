/**
 * lineMemberCatalog unit test (#309 案A)
 *
 * LINE group member profile (= displayName) の取得 + file cache。
 * lineGroupCatalog と同型 (atomic write / 既取得 skip / fail silent)。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

const {
  fetchMemberProfile,
  getMemberDisplayName,
} = require('../../src/services/lineMemberCatalog');

function okResp(body) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body };
}
function errResp(status) {
  return { ok: false, status, statusText: `S${status}`, json: async () => ({}) };
}

let tmpDir;
let membersFile;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-member-test-'));
  membersFile = path.join(tmpDir, 'line-members.json');
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('fetchMemberProfile', () => {
  test('GET .../member/{userId} を呼び displayName を返す', async () => {
    const fetchImpl = jest.fn(async () => okResp({ displayName: '小野仙人', pictureUrl: 'http://x/p.jpg', userId: 'U1' }));
    const out = await fetchMemberProfile('G1', 'U1', 'tok', { fetchImpl });
    expect(out).toEqual({ displayName: '小野仙人', pictureUrl: 'http://x/p.jpg', userId: 'U1' });
    const calledUrl = fetchImpl.mock.calls[0][0];
    expect(calledUrl).toContain('/group/G1/member/U1');
  });

  test('非2xx は throw', async () => {
    const fetchImpl = jest.fn(async () => errResp(404));
    await expect(fetchMemberProfile('G1', 'U1', 'tok', { fetchImpl })).rejects.toThrow(/404/);
  });
});

describe('getMemberDisplayName', () => {
  test('cache miss → fetch して名前を返し file に保存', async () => {
    const fetchImpl = jest.fn(async () => okResp({ displayName: '小野仙人' }));
    const name = await getMemberDisplayName('G1', 'U1', 'tok', { fetchImpl, filePath: membersFile });
    expect(name).toBe('小野仙人');
    const saved = JSON.parse(fs.readFileSync(membersFile, 'utf8'));
    expect(saved.U1.name).toBe('小野仙人');
  });

  test('cache hit → fetch せず返す', async () => {
    fs.writeFileSync(membersFile, JSON.stringify({ U1: { name: '既存太郎' } }));
    const fetchImpl = jest.fn();
    const name = await getMemberDisplayName('G1', 'U1', 'tok', { fetchImpl, filePath: membersFile });
    expect(name).toBe('既存太郎');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('userId / accessToken 無しは null (= API call なし)', async () => {
    const fetchImpl = jest.fn();
    expect(await getMemberDisplayName('G1', null, 'tok', { fetchImpl, filePath: membersFile })).toBeNull();
    expect(await getMemberDisplayName('G1', 'U1', null, { fetchImpl, filePath: membersFile })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('fetch 失敗は null (= silent degrade、throw しない)', async () => {
    const fetchImpl = jest.fn(async () => errResp(403));
    const name = await getMemberDisplayName('G1', 'U1', 'tok', { fetchImpl, filePath: membersFile });
    expect(name).toBeNull();
  });
});

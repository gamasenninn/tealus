/**
 * #331 organon dock watcher の unit test。
 *
 * cadence = 「TTL 到着 watch」: organon.ttl の内容 hash が変わった時だけ
 * syncFromOrganon → refreshVocabFromTable を発火。同一内容では no-op (無駄 reload なし)。
 * sync 失敗時は lastHash を進めず次 tick で retry。DB・pool には触れない (依存は全て mock)。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
} }));
jest.mock('../../scripts/sync_organon_dict.mts', () => ({ syncFromOrganon: jest.fn() }));
jest.mock('../../src/services/transcriptionConfig.mts', () => ({ refreshVocabFromTable: jest.fn() }));

import { checkAndSync, stop } from '../../src/services/organonWatcher.mts';
import { syncFromOrganon } from '../../scripts/sync_organon_dict.mts';
import { refreshVocabFromTable } from '../../src/services/transcriptionConfig.mts';

const mockSync = syncFromOrganon as jest.Mock;
const mockRefresh = refreshVocabFromTable as jest.Mock;

let tmpDir: string;
let ttlPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-watch-test-'));
  ttlPath = path.join(tmpDir, 'organon.ttl');
  mockSync.mockReset().mockResolvedValue({ terms: 3, aliases: 5 });
  mockRefresh.mockReset().mockResolvedValue(3);
  stop(); // module 状態 (_lastHash) をリセット
});

afterEach(() => {
  stop();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('organonWatcher.checkAndSync', () => {
  test('新規 TTL → changed=true、sync + refresh を各1回発火', async () => {
    fs.writeFileSync(ttlPath, '@prefix org1: <x> .\norg1:A a org1:Role .');
    const r = await checkAndSync(ttlPath);
    expect(r.changed).toBe(true);
    expect(r.hash).toBeTruthy();
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith(ttlPath);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  test('同一内容の2回目 → changed=false、再発火しない (無駄 reload なし)', async () => {
    fs.writeFileSync(ttlPath, 'same-content');
    await checkAndSync(ttlPath);
    const r = await checkAndSync(ttlPath);
    expect(r.changed).toBe(false);
    expect(mockSync).toHaveBeenCalledTimes(1); // 増えない
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  test('内容が変わったら → 再度 changed=true で発火', async () => {
    fs.writeFileSync(ttlPath, 'v1');
    await checkAndSync(ttlPath);
    fs.writeFileSync(ttlPath, 'v2-changed');
    const r = await checkAndSync(ttlPath);
    expect(r.changed).toBe(true);
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  test('TTL が存在しない → changed=false、sync は呼ばない (base は organon 非依存)', async () => {
    const r = await checkAndSync(path.join(tmpDir, 'nonexistent.ttl'));
    expect(r.changed).toBe(false);
    expect(r.hash).toBeNull();
    expect(mockSync).not.toHaveBeenCalled();
  });

  test('sync 失敗 → changed=false、lastHash を進めず次 tick で retry', async () => {
    fs.writeFileSync(ttlPath, 'content');
    mockSync.mockRejectedValueOnce(new Error('boom'));
    const r1 = await checkAndSync(ttlPath);
    expect(r1.changed).toBe(false);
    // 同一内容でも lastHash 未更新なので再試行される
    const r2 = await checkAndSync(ttlPath);
    expect(r2.changed).toBe(true);
    expect(mockSync).toHaveBeenCalledTimes(2);
    expect(mockRefresh).toHaveBeenCalledTimes(1); // 成功した2回目のみ
  });
});

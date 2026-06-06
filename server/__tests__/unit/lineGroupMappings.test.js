/**
 * lineGroupMappings unit test (= Phase 2.3、6/6 Day 21 確立)
 *
 * D2 object form + pure string form 後方互換 + env fallback の優先順を verify。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { loadGroupToRoomMap, normalizeMap, getGroupMappingMeta } = require('../../src/services/lineGroupMappings');

let tmpDir;
let tmpFile;
let origMappingsEnv;
let origEnvMap;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-mappings-test-'));
  tmpFile = path.join(tmpDir, 'mappings.json');
  // ★ ★ 本番 mappings file / env 上書き防止 (= memory feedback_test_file_guard.md 適用)
  origMappingsEnv = process.env.LINE_GROUP_TO_ROOM_FILE;
  origEnvMap = process.env.LINE_GROUP_TO_ROOM;
  process.env.LINE_GROUP_TO_ROOM_FILE = tmpFile;
  delete process.env.LINE_GROUP_TO_ROOM; // 各 test で options.envValue で明示
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  if (origMappingsEnv === undefined) delete process.env.LINE_GROUP_TO_ROOM_FILE;
  else process.env.LINE_GROUP_TO_ROOM_FILE = origMappingsEnv;
  if (origEnvMap === undefined) delete process.env.LINE_GROUP_TO_ROOM;
  else process.env.LINE_GROUP_TO_ROOM = origEnvMap;
});

describe('normalizeMap', () => {
  test('object form (= D2 採用) → { groupId: roomId } flat', () => {
    const raw = {
      g1: { room_id: 'r1', description: '営業部' },
      g2: { room_id: 'r2' },
    };
    expect(normalizeMap(raw)).toEqual({ g1: 'r1', g2: 'r2' });
  });

  test('pure string form (= 後方互換) → そのまま flat', () => {
    expect(normalizeMap({ g1: 'r1', g2: 'r2' })).toEqual({ g1: 'r1', g2: 'r2' });
  });

  test('object + pure mixed → 両方 flat 化', () => {
    expect(normalizeMap({
      g1: { room_id: 'r1', description: 'desc' },
      g2: 'r2',
    })).toEqual({ g1: 'r1', g2: 'r2' });
  });

  test('_comment / _format 等 meta key は skip', () => {
    expect(normalizeMap({
      _comment: 'sample comment',
      _format: 'D2',
      g1: 'r1',
    })).toEqual({ g1: 'r1' });
  });

  test('不正 form (= null / 数値 / object に room_id なし) は silent skip', () => {
    expect(normalizeMap({
      g1: null,
      g2: 123,
      g3: { description: 'no room_id' },
      g4: 'r4',
    })).toEqual({ g4: 'r4' });
  });

  test('null / undefined / 非 object → 空 object', () => {
    expect(normalizeMap(null)).toEqual({});
    expect(normalizeMap(undefined)).toEqual({});
    expect(normalizeMap('string')).toEqual({});
  });
});

describe('loadGroupToRoomMap (= priority: file > env > empty)', () => {
  test('priority 1: file 存在 → file から load (= D2 object form)', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({
      C123: { room_id: 'room-A', description: '営業部' },
    }));
    const result = loadGroupToRoomMap({ filePath: tmpFile, envValue: '{"OLD":"old-room"}' });
    expect(result).toEqual({ C123: 'room-A' });
    expect(result.OLD).toBeUndefined();  // env は無視される
  });

  test('priority 2: file なし + env あり → env fallback (= 既存運用維持)', () => {
    const result = loadGroupToRoomMap({
      filePath: '/nonexistent/path.json',
      envValue: '{"C456":"room-B"}',
    });
    expect(result).toEqual({ C456: 'room-B' });
  });

  test('priority 3: 両方なし → 空 object', () => {
    const result = loadGroupToRoomMap({ filePath: '/nonexistent', envValue: undefined });
    expect(result).toEqual({});
  });

  test('file parse error → env fallback', () => {
    fs.writeFileSync(tmpFile, 'not json {{{');
    const result = loadGroupToRoomMap({ filePath: tmpFile, envValue: '{"C789":"room-C"}' });
    expect(result).toEqual({ C789: 'room-C' });
  });

  test('env invalid JSON → 空 object (= silent fallback)', () => {
    const result = loadGroupToRoomMap({ filePath: '/nonexistent', envValue: 'not json' });
    expect(result).toEqual({});
  });
});

describe('getGroupMappingMeta (= description 等 metadata 取得)', () => {
  test('object form → { room_id, description }', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({
      C123: { room_id: 'room-A', description: '営業部' },
    }));
    expect(getGroupMappingMeta('C123', { filePath: tmpFile })).toEqual({
      room_id: 'room-A',
      description: '営業部',
    });
  });

  test('pure form → description null', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ C123: 'room-A' }));
    expect(getGroupMappingMeta('C123', { filePath: tmpFile })).toEqual({
      room_id: 'room-A',
      description: null,
    });
  });

  test('未登録 group → null', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ C123: 'r' }));
    expect(getGroupMappingMeta('C999', { filePath: tmpFile })).toBeNull();
  });
});

/**
 * G-1 (2026-10-27) ★ 新しいルームの初期化で作る CLAUDE.md / room_settings.json は workspace の外 (_room-configs) に置く。
 *   sessionManager.test.mts は fs をモックしているので、ここでは本物のファイルで置き場を確かめる。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: jest.fn(), on: jest.fn() })) }));
jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

import { initWorkspace } from '../../src/context/sessionManager.mts';
import { roomConfigPath, readRoomConfig } from '../../src/lib/roomConfigPaths.mts';

let root: string;
let ws: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'init-ws-'));
  ws = path.join(root, 'agent-1', 'room-1');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('★★ CLAUDE.md と room_settings.json は workspace の中に作らない (外の置き場に作る)', () => {
  initWorkspace(ws);
  expect(fs.existsSync(path.join(ws, 'CLAUDE.md'))).toBe(false);
  expect(fs.existsSync(path.join(ws, 'room_settings.json'))).toBe(false);
  expect(fs.existsSync(roomConfigPath(ws, 'CLAUDE.md'))).toBe(true);
  expect(JSON.parse(readRoomConfig(ws, 'room_settings.json')!)).toEqual({ response_mode: 'auto', enabled: true });
});

test('workspace 側 (memory / files / temp / memory/MEMORY.md) は今までどおり作る', () => {
  initWorkspace(ws);
  for (const d of ['memory', 'files', 'temp']) expect(fs.statSync(path.join(ws, d)).isDirectory()).toBe(true);
  expect(fs.existsSync(path.join(ws, 'memory', 'MEMORY.md'))).toBe(true);
});

test('★ 既に外の置き場にあれば上書きしない (管理者が編集した指示を初期化で消さない)', () => {
  fs.mkdirSync(path.dirname(roomConfigPath(ws, 'CLAUDE.md')), { recursive: true });
  fs.writeFileSync(roomConfigPath(ws, 'CLAUDE.md'), '# 管理者の指示');
  initWorkspace(ws);
  expect(readRoomConfig(ws, 'CLAUDE.md')).toBe('# 管理者の指示');
});

test('★ 旧 (workspace 内) にあれば、初期化で外へ移して旧は消す', () => {
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'room_settings.json'), '{"response_mode":"mention","enabled":true}');
  initWorkspace(ws);
  expect(fs.existsSync(path.join(ws, 'room_settings.json'))).toBe(false);
  expect(JSON.parse(readRoomConfig(ws, 'room_settings.json')!).response_mode).toBe('mention');
});

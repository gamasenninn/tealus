/**
 * G-1 (2026-10-27) ★★ ルームの設定ファイル (AI を制御するもの) を workspace の外に置く。
 *
 * ★ `room_settings.json` (応答モード) / `light_prompt.md` (ルーム固有の指示) / `mcp_config.json` (ルームの道具) /
 *   `CLAUDE.md` (Deep の指示) は、これまで `<WORKSPACE_ROOT>/<agentId>/<roomId>/` = **AI の作業場所**に置いてあった。
 *   そこは filesystem MCP の root で、AI が write_file で書ける。注入された AI が自分の指示を書き換えて
 *   次回以降に持ち越せる (response_mode=all にする・MCP のコマンドを足す = 610857c の絞りを素通り)。
 * ★★ #419 (`_mcp-configs` / `_codex-homes`) と同じ形で `<WORKSPACE_ROOT>/_room-configs/<agentId>/<roomId>/` へ移す。
 * ★★★ 読みは新しい置き場が先。無ければ旧 (workspace 内) を **1 度だけ**読んで移し、旧は消す
 *   (残すと AI がそこに書いたものが次に読まれる理由になる。#419 の「古いものを消す」と同じ)。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

import {
  ROOM_CONFIG_FILES,
  roomConfigDir,
  roomConfigPath,
  readRoomConfig,
  writeRoomConfig,
  roomConfigExists,
  readRoomConfigJson,
} from '../../src/lib/roomConfigPaths.mts';
import { deepMcpConfigPath } from '../../src/agents/deep.mts';
import { buildLightV2McpConfig } from '../../src/agents/lightV2.mts';

let root: string;
let ws: string;
const AGENT = 'agent-1';
const ROOM = 'room-1';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'room-cfg-'));
  ws = path.join(root, AGENT, ROOM);
  fs.mkdirSync(ws, { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('置き場', () => {
  test('★★ <WORKSPACE_ROOT>/_room-configs/<agentId>/<roomId>/<file> (#419 の _mcp-configs と同じ考え方)', () => {
    expect(roomConfigDir(ws)).toBe(path.join(root, '_room-configs', AGENT, ROOM));
    expect(roomConfigPath(ws, 'room_settings.json')).toBe(path.join(root, '_room-configs', AGENT, ROOM, 'room_settings.json'));
  });

  test('★★ workspace の下に入っていない (filesystem MCP の root から出す)', () => {
    for (const f of ROOM_CONFIG_FILES) {
      const rel = path.relative(ws, roomConfigPath(ws, f));
      expect(rel.startsWith('..')).toBe(true);
    }
  });

  test('★ Light v2 が filesystem MCP に渡す root は workspace そのもの = 置き場はその外', () => {
    const cfg = buildLightV2McpConfig(ws) as Record<string, { args: string[] }>;
    const fsRoot = cfg['workspace-fs'].args.at(-1)!.replace(/\//g, path.sep);
    expect(path.relative(fsRoot, roomConfigDir(ws)).startsWith('..')).toBe(true);
  });

  test('★ deep の MCP 設定 (_mcp-configs) と同じ親 (WORKSPACE_ROOT) に並ぶ', () => {
    // roomConfigDir = ROOT/_room-configs/<agent>/<room>、deepMcpConfigPath = ROOT/_mcp-configs/<agent>/<room>.json
    expect(path.dirname(path.dirname(path.dirname(roomConfigDir(ws)))))
      .toBe(path.dirname(path.dirname(path.dirname(deepMcpConfigPath(ws)))));
  });

  test('4 つのファイルを全部知っている', () => {
    expect([...ROOM_CONFIG_FILES].sort()).toEqual(['CLAUDE.md', 'light_prompt.md', 'mcp_config.json', 'room_settings.json']);
  });
});

describe('読み書き', () => {
  test('無ければ null', () => {
    expect(readRoomConfig(ws, 'light_prompt.md')).toBeNull();
    expect(roomConfigExists(ws, 'light_prompt.md')).toBe(false);
  });

  test('★ 書くのは新しい置き場だけ (workspace には何も残さない)', () => {
    writeRoomConfig(ws, 'light_prompt.md', 'ルームの決まり');
    expect(fs.readFileSync(roomConfigPath(ws, 'light_prompt.md'), 'utf8')).toBe('ルームの決まり');
    expect(fs.existsSync(path.join(ws, 'light_prompt.md'))).toBe(false);
    expect(readRoomConfig(ws, 'light_prompt.md')).toBe('ルームの決まり');
    expect(roomConfigExists(ws, 'light_prompt.md')).toBe(true);
  });

  test('JSON は壊れていたら null (黙って既定に倒す判断は呼び出し側)', () => {
    writeRoomConfig(ws, 'room_settings.json', '{ broken');
    expect(readRoomConfigJson(ws, 'room_settings.json')).toBeNull();
    writeRoomConfig(ws, 'room_settings.json', '{"response_mode":"all"}');
    expect(readRoomConfigJson<{ response_mode: string }>(ws, 'room_settings.json')?.response_mode).toBe('all');
  });
});

describe('★★★ 旧 (workspace 内) からの移行は 1 度だけ', () => {
  test('新しい置き場に無く、旧にあれば: 読んで移し、旧を消す', () => {
    fs.writeFileSync(path.join(ws, 'room_settings.json'), '{"response_mode":"mention"}');
    expect(readRoomConfig(ws, 'room_settings.json')).toBe('{"response_mode":"mention"}');
    // 移った
    expect(fs.readFileSync(roomConfigPath(ws, 'room_settings.json'), 'utf8')).toBe('{"response_mode":"mention"}');
    // ★ 旧は消えている (AI がそこに書いても次は読まれない)
    expect(fs.existsSync(path.join(ws, 'room_settings.json'))).toBe(false);
  });

  test('★★ 新しい置き場にあれば、旧 (AI が後から置いたもの) は読まない・消さない・上書きしない', () => {
    writeRoomConfig(ws, 'light_prompt.md', '管理者の指示');
    fs.writeFileSync(path.join(ws, 'light_prompt.md'), 'AI が書いた指示');
    expect(readRoomConfig(ws, 'light_prompt.md')).toBe('管理者の指示');
    expect(fs.readFileSync(roomConfigPath(ws, 'light_prompt.md'), 'utf8')).toBe('管理者の指示');
  });

  test('★ 存在の確認 (exists) でも移行は走る (読む前に exists で分岐する呼び出し側がある)', () => {
    fs.writeFileSync(path.join(ws, 'mcp_config.json'), '{"mcpServers":{}}');
    expect(roomConfigExists(ws, 'mcp_config.json')).toBe(true);
    expect(fs.existsSync(roomConfigPath(ws, 'mcp_config.json'))).toBe(true);
    expect(fs.existsSync(path.join(ws, 'mcp_config.json'))).toBe(false);
  });

  test('workspace 自体が無くても落ちない', () => {
    const missing = path.join(root, AGENT, 'no-such-room');
    expect(readRoomConfig(missing, 'CLAUDE.md')).toBeNull();
  });
});

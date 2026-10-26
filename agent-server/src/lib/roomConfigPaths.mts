/**
 * ルームの設定ファイルの置き場 (G-1、2026-10-27)
 *
 * ★ なぜ要るか: ルームの設定 4 つ (`room_settings.json` 応答モード / `light_prompt.md` ルーム固有の指示 /
 *   `mcp_config.json` ルームの道具 / `CLAUDE.md` Deep の指示) は、**AI の作業場所** `<WORKSPACE_ROOT>/<agentId>/<roomId>/`
 *   に置いてあった。そこは filesystem MCP の root (Light v1 / v2) で、Deep の cwd でもある = **AI が書ける**。
 *   注入された AI が自分の指示を書き換えて次回以降に持ち越せ、`response_mode: all` にしたり、
 *   `mcp_config.json` にコマンドを足したりできた (610857c で HTTP の書き込みを管理者に絞ったが、ファイルは素通り)。
 *
 * ★★ 置き場は #419 (`_mcp-configs` / `_codex-homes`) と同じ形:
 *   `<WORKSPACE_ROOT>/_room-configs/<agentId>/<roomId>/<file>`
 *   (workspacePath = `<WORKSPACE_ROOT>/<agentId>/<roomId>` から 2 つ上が WORKSPACE_ROOT。deepMcpConfigPath と同じ約束)
 *
 * ★★★ 読み: 新しい置き場だけ。旧 (workspace 内) からの移行は**起動のときに 1 度だけ** (migrateAllRoomConfigs)。
 *   ★ 読むたびに「無ければ旧から移す」にすると、設定の無い部屋で AI が workspace に置いたファイルが
 *   次の読みで移されて効いてしまう (= 塞いだ穴がそのまま残る)。起動の後に workspace に現れたものは読まない
 * ★ 書き: 新しい置き場だけ。
 *
 * ★ これは「filesystem MCP の root の外・cwd の外」という置き方で守る。Deep は sandbox 無しで走るので
 *   (--dangerously-skip-permissions / --dangerously-bypass-approvals-and-sandbox)、シェルで絶対パスを知って書けば届く。
 *   #419 の資格情報と同じ限界。作業場所を列挙しても見えない・道具 (write_file) からは届かない、が守りの中身。
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.mts';

export const ROOM_CONFIG_DIR_NAME = '_room-configs';

export const ROOM_CONFIG_FILES = ['room_settings.json', 'light_prompt.md', 'mcp_config.json', 'CLAUDE.md'] as const;
export type RoomConfigFile = (typeof ROOM_CONFIG_FILES)[number];

/** `<WORKSPACE_ROOT>/_room-configs/<agentId>/<roomId>` */
export function roomConfigDir(workspacePath: string): string {
  const roomDir = path.basename(workspacePath);
  const agentDir = path.basename(path.dirname(workspacePath));
  const workspaceRoot = path.dirname(path.dirname(workspacePath));
  return path.join(workspaceRoot, ROOM_CONFIG_DIR_NAME, agentDir, roomDir);
}

/** `<WORKSPACE_ROOT>/_room-configs/<agentId>/<roomId>/<file>` */
export function roomConfigPath(workspacePath: string, file: RoomConfigFile): string {
  return path.join(roomConfigDir(workspacePath), file);
}

/** 旧の置き場 (workspace の中)。★ 移行の読み出しと削除だけに使う。新しく書かない */
function legacyPath(workspacePath: string, file: RoomConfigFile): string {
  return path.join(workspacePath, file);
}

/**
 * 起動のときに 1 度だけ、すべての部屋の旧 (workspace 内) の設定を外へ移す。
 * - `<root>/<agentId>/<roomId>/<file>` が対象 (`_` で始まる置き場は見ない)
 * - 新しい置き場に既にあれば移さない (旧は読まれないまま残る)
 * - 移したら旧は消す
 * @returns 移した数
 */
export function migrateAllRoomConfigs(workspaceRoot: string): number {
  let moved = 0;
  let agents: fs.Dirent[] = [];
  try { agents = fs.readdirSync(workspaceRoot, { withFileTypes: true }); } catch { return 0; }
  for (const a of agents) {
    if (!a.isDirectory() || a.name.startsWith('_')) continue;
    let rooms: fs.Dirent[] = [];
    try { rooms = fs.readdirSync(path.join(workspaceRoot, a.name), { withFileTypes: true }); } catch { continue; }
    for (const r of rooms) {
      if (!r.isDirectory()) continue;
      const ws = path.join(workspaceRoot, a.name, r.name);
      for (const file of ROOM_CONFIG_FILES) {
        const old = legacyPath(ws, file);
        const next = roomConfigPath(ws, file);
        if (!fs.existsSync(old) || fs.existsSync(next)) continue;
        try {
          fs.mkdirSync(path.dirname(next), { recursive: true });
          fs.copyFileSync(old, next);
          fs.unlinkSync(old);
          moved++;
        } catch (err) {
          logger.error(`[room-config] workspace 内の ${file} を外へ移せませんでした (この設定は効きません): ${old}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  if (moved > 0) logger.info(`[room-config] workspace 内の設定 ${moved} 個を外 (${ROOM_CONFIG_DIR_NAME}) へ移しました (G-1)`);
  return moved;
}

/** 新しい置き場にあるか (★ workspace 内は見ない) */
export function roomConfigExists(workspacePath: string, file: RoomConfigFile): boolean {
  return fs.existsSync(roomConfigPath(workspacePath, file));
}

/** 中身を読む。無ければ null (★ workspace 内は見ない) */
export function readRoomConfig(workspacePath: string, file: RoomConfigFile): string | null {
  const p = roomConfigPath(workspacePath, file);
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    logger.warn(`[room-config] ${file} を読めませんでした: ${p}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** JSON として読む。無い・壊れているときは null */
export function readRoomConfigJson<T = unknown>(workspacePath: string, file: RoomConfigFile): T | null {
  const text = readRoomConfig(workspacePath, file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    logger.warn(`[room-config] ${file} が JSON として壊れています: ${roomConfigPath(workspacePath, file)}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** 新しい置き場に書く (★ workspace には書かない) */
export function writeRoomConfig(workspacePath: string, file: RoomConfigFile, content: string): void {
  const p = roomConfigPath(workspacePath, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

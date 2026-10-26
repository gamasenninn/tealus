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
 * ★★★ 読み: 新しい置き場が先。無ければ旧 (workspace 内) を **1 度だけ**読んで移し、**旧は消す**。
 *   残すと「AI がそこに書いたもの」が次に読まれる理由になる (#419 の「古いものを消す」と同じ)。
 *   新しい置き場に既にあれば、旧に何があっても読まない・消さない (AI が後から置いたものかもしれない)。
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
 * 旧 (workspace 内) にあって新しい置き場に無ければ移す (1 度だけ)。
 * @returns 移したら true
 */
function migrateIfNeeded(workspacePath: string, file: RoomConfigFile): boolean {
  const next = roomConfigPath(workspacePath, file);
  if (fs.existsSync(next)) return false;
  const old = legacyPath(workspacePath, file);
  if (!fs.existsSync(old)) return false;
  try {
    const content = fs.readFileSync(old, 'utf8');
    fs.mkdirSync(path.dirname(next), { recursive: true });
    fs.writeFileSync(next, content);
    fs.unlinkSync(old);
    logger.info(`[room-config] workspace 内の ${file} を外へ移しました (G-1): ${old} → ${next}`);
    return true;
  } catch (err) {
    // ★ 移せなかったときは旧を読まない (読むと AI が書ける場所が効き続ける)。壊れた沈黙にならないよう error で残す
    logger.error(`[room-config] workspace 内の ${file} を外へ移せませんでした (この設定は効きません): ${old}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 新しい置き場にあるか (★ 旧にしか無ければ先に移す) */
export function roomConfigExists(workspacePath: string, file: RoomConfigFile): boolean {
  migrateIfNeeded(workspacePath, file);
  return fs.existsSync(roomConfigPath(workspacePath, file));
}

/** 中身を読む。無ければ null (★ 旧にしか無ければ先に移す) */
export function readRoomConfig(workspacePath: string, file: RoomConfigFile): string | null {
  migrateIfNeeded(workspacePath, file);
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

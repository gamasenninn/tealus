/**
 * 設定 API (/config/*) の権限 (#458、2026-09-26)
 *
 * ★ それまで: ログインしているか (JWT の署名) しか見ておらず、一般の利用者でも全ルームの設定・全体の設定を書けた。
 *
 * ★★ 形 (利用者判断 2026-09-26): **資源の持ち主 (agent-server) が自分で判断する。**
 *   事実 (役割・ルームでの役割) は、**利用者自身の鍵で** 本体 (GET /api/auth/authz) に聞く。
 *   - 中継 (/agent-api) で確かめる案は採らない: 4000 番に直接届けば素通り / 別サーバに分けたら中継が無くなる
 *   - 利用者の鍵で聞くので、本体はその人の権限でしか答えない (ボットの強い権限を借りて「X さんは?」と聞かない)
 *   - 本体は無効化した利用者を 401 にする → 鍵の期限 (7 日) が残っていても止まる
 *   - 本体は事実だけを返す。「設定を書いてよいか」の決まりはここ 1 か所 (isAllowed)
 *
 * ★ 決め方 (本体アプリの画面の表示条件と同じ):
 *   /tts-options           ログインしていればよい (秘密を含まない選択肢)
 *   /room/:roomId/...      システム管理者 / そのルームの管理者 / DM の当人
 *   それ以外 (全体・知らない道)  システム管理者だけ (★ 足した道を黙って開けない)
 *
 * ★ 本体に聞けないときは断る (503)。結果は同じ鍵・同じルームで 10 秒覚える
 *   (ルーム設定の画面は 1 度に 4 本呼ぶ)。失敗は覚えない。
 *
 * @module lib/configAuthz
 */
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.mts';

export type ConfigPathKind = { kind: 'open' } | { kind: 'global' } | { kind: 'room'; roomId: string };

export interface AuthzFacts {
  user_id: string;
  role: string;
  room: { id: string; type: string; member_role: string | null } | null;
}

/** ★ 秘密を含まず、ログインだけでよい道 */
const OPEN_PATHS = new Set(['/tts-options']);
const ROOM_PATH = /^\/room\/([^/]+)(?:\/|$)/;

export function classifyConfigPath(p: string): ConfigPathKind {
  if (OPEN_PATHS.has(p)) return { kind: 'open' };
  const m = ROOM_PATH.exec(p);
  if (m) return { kind: 'room', roomId: decodeURIComponent(m[1]) };
  return { kind: 'global' };
}

/** ★ 判断の表 (純関数)。ここだけが「だれが何を触ってよいか」を知っている */
export function isAllowed(kind: ConfigPathKind, f: AuthzFacts): boolean {
  if (kind.kind === 'open') return true;
  if (f.role === 'admin') return true;
  if (kind.kind === 'global') return false;
  const room = f.room;
  if (!room) return false;
  if (room.member_role === 'admin') return true;
  return room.type === 'direct' && room.member_role !== null;
}

export interface ConfigAuthzOptions {
  apiUrl: string;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
  /** ★ 覚えておく時間 (既定 10 秒) */
  ttlMs?: number;
}

type Lookup = { status: 'ok'; facts: AuthzFacts } | { status: 'unauthorized' };

export function createConfigAuthz({ apiUrl, fetchImpl, now = Date.now, ttlMs = 10_000 }: ConfigAuthzOptions) {
  const cache = new Map<string, { at: number; value: Lookup }>();

  async function lookup(token: string, roomId: string | undefined): Promise<Lookup> {
    // ★ 鍵そのものは覚えない (ハッシュをキーにする)
    const key = `${crypto.createHash('sha256').update(token).digest('hex')}|${roomId ?? ''}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at <= ttlMs) return hit.value;

    const doFetch = fetchImpl || globalThis.fetch;
    const url = `${apiUrl}/api/auth/authz${roomId !== undefined ? `?room_id=${encodeURIComponent(roomId)}` : ''}`;
    const res = await doFetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) } as RequestInit);
    if (res.status === 401) {
      const value: Lookup = { status: 'unauthorized' };
      cache.set(key, { at: now(), value });
      return value;
    }
    if (!res.ok) throw new Error(`authz ${res.status}`);   // ★ 覚えない
    const value: Lookup = { status: 'ok', facts: (await res.json()) as AuthzFacts };
    cache.set(key, { at: now(), value });
    // ★ 古いものを掃除 (鍵の数だけ増え続けないように)
    if (cache.size > 500) for (const [k, v] of cache) if (now() - v.at > ttlMs) cache.delete(k);
    return value;
  }

  return async function configAuthz(req: Request, res: Response, next: NextFunction): Promise<void> {
    const kind = classifyConfigPath(req.path);
    if (kind.kind === 'open') return next();

    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) { res.status(401).json({ error: '認証が必要です' }); return; }

    let got: Lookup;
    try {
      got = await lookup(token, kind.kind === 'room' ? kind.roomId : undefined);
    } catch (err) {
      // ★ 聞けないときは断る (安全側)
      logger.warn(`[config-authz] 本体に権限を確かめられないため断ります: ${err instanceof Error ? err.message : String(err)}`);
      res.status(503).json({ error: '権限を確かめられません。しばらくしてからやり直してください' });
      return;
    }
    if (got.status === 'unauthorized') { res.status(401).json({ error: 'トークンが無効です' }); return; }
    if (!isAllowed(kind, got.facts)) {
      logger.info(`[config-authz] 403 ${req.method} /config${req.path} user=${got.facts.user_id} role=${got.facts.role}`);
      res.status(403).json({ error: kind.kind === 'room' ? 'このルームの設定を変える権限がありません' : '管理者権限が必要です' });
      return;
    }
    next();
  };
}

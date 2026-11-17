/**
 * ログインの札 (docs/11 §5.5、2026-11-17)。ブラウザから「Tealus でログイン」するための、相手のサイト向けの札。
 *
 * ★ パネルの通行証 (appPass.mts) と同じ形・同じ鍵だが、種類 typ:"login" と相手の合言葉 state を持つ。
 *   相手の入口 (/tealus-gate/) は typ のある札を落とす (落とさないと、ログインの札で入口を通れる)。
 * ★ 戻り先は引数で受けない。本体の設定 APP_LOGIN_TARGETS の許可表だけが持つ (よそへ札を飛ばされない)。
 *   相手のサイト名は公開の repo に入れないので、コードに直書きしない
 */
import crypto from 'node:crypto';

/** 札の期限 (秒)。ログインの戻りはすぐ終わるので、パネルの通行証 (120 秒) より短くする */
export const APP_LOGIN_TTL_SEC = 60;

/** 相手が作る合言葉の形 (ログインのすり替え対策。相手は自分のクッキーと照らす) */
export const LOGIN_STATE_RE = /^[0-9a-f]{32}$/;

export interface AppLoginClaims {
  aud: string;
  sub: string;
  name: string;
  state: string;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signAppLogin(key: Buffer, claims: AppLoginClaims, nowSec: number): string {
  const payload = {
    v: 1, typ: 'login', aud: claims.aud, sub: claims.sub, name: claims.name, state: claims.state,
    iat: nowSec, exp: nowSec + APP_LOGIN_TTL_SEC,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  // ★ 署名の対象は「送る文字列そのまま」(docs/11 §4.1。パネルの通行証と同じ)
  const sig = b64url(crypto.createHmac('sha256', key).update(`v1.${body}`).digest());
  return `v1.${body}.${sig}`;
}

/**
 * `<origin>|<戻り先のパス>` をカンマで並べた設定を読む。崩れた行は捨てる (黙って広げない側に倒す)。
 * origin は https で、パスも問い合わせも付かない形 (`new URL(x).origin === x`) に限る
 */
export function parseLoginTargets(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of (raw ?? '').split(',')) {
    const [origin, cbPath, ...rest] = item.trim().split('|').map((s) => s.trim());
    if (!origin || !cbPath || rest.length > 0) continue;
    let u: URL;
    try { u = new URL(origin); } catch { continue; }
    if (u.protocol !== 'https:' || u.origin !== origin) continue;
    if (!cbPath.startsWith('/') || cbPath.startsWith('//') || cbPath.startsWith('/\\')) continue;
    map.set(origin, cbPath);
  }
  return map;
}

export function loginCallbackUrl(origin: string, cbPath: string, token: string): string {
  return `${origin}${cbPath}${cbPath.includes('?') ? '&' : '?'}tealus_login=${encodeURIComponent(token)}`;
}

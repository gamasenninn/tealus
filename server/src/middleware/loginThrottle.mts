/**
 * #362 login の総当たり抑止ミドルウェア。
 *
 * 数え方の理屈は `services/loginThrottle.mts` の冒頭を読むこと (失敗だけ数える理由)。
 * ここは express への繋ぎだけを持つ。
 *
 * ## ★ 鍵に使う IP について (経路が 3 段あるので注意)
 *
 *   client → Cloudflare → NAS(nginx) 192.168.11.213 → 本体 :3000
 *
 * `trust proxy` を設定しないと `req.ip` は **NAS の IP** になり、外から来た全員が
 * 同じ鍵に集まる。そうなると鍵は実質 login_id だけになり、
 * ★★ **攻撃者が 5 回失敗するだけで、その ID の正規利用者 (cc-bridge を含む) を締め出せる。**
 * → `app.set('trust proxy', <proxy の IP>)` を入れること (`app.mts`、env `TRUST_PROXY`)。
 *   未設定なら起動ログが警告する。
 *
 * ★★ ただし **取れるのは実 client ではない**。実測 (2026-09-08):
 *     Cloudflare 経由 → Cloudflare のエッジ IP / origin 直撃 → 攻撃者の実 IP。
 *     どちらも詐称できない (nginx が追記した最後の 1 つを採るため) が、
 *     **同じエッジを共有する利用者は 1 つの鍵に集まる**。分かった上で選んでいる。
 *     ★ `CF-Connecting-IP` は採らない —— origin 直撃も同じ nginx を通るので自分で付けられる。
 *
 * ## ★ この仕組みが止められないもの (承知の上で選んでいる)
 *
 * **IP を跨いだ分散攻撃は止まらない。** login_id だけで数えれば止まるが、それは
 * 「攻撃者が任意の利用者を締め出せる」ことと同義で、cc-bridge も巻き添えになる
 * (= #362 が避けたかった自己締め出しが、別の扉から戻る)。
 * 単一の発信元からの総当たりを止める、という範囲に留める。
 */
import type { Request, Response, NextFunction } from 'express';
import {
  createLoginThrottle, keyOf, type LoginThrottle,
} from '../services/loginThrottle.mts';
import * as E from '../constants/errors.mts';

/** 鍵に使う login_id の最大長。長い文字列で memory を伸ばされないため */
export const MAX_KEY_LOGIN_ID_LEN = 128;

/** プロセス全体で 1 つ。login は 1 か所しかないので共有で足りる */
export const loginThrottle: LoginThrottle = createLoginThrottle();

export interface LoginThrottleMiddlewareDeps {
  throttle?: LoginThrottle;
}

/** req に生やす鍵 (ハンドラが成否を記録するのに使う) */
declare module 'express-serve-static-core' {
  interface Request {
    loginThrottleKey?: string;
  }
}

/**
 * ★ 何が来ても文字列に落とす。login_id は外から来るので、配列でもオブジェクトでも落ちない。
 *   (オブジェクトを渡して鍵を壊す / 長い文字列で memory を伸ばす、をここで止める)
 */
function normalizeLoginId(value: unknown): string {
  const s = typeof value === 'string' ? value : (value == null ? '' : JSON.stringify(value) ?? '');
  return s.slice(0, MAX_KEY_LOGIN_ID_LEN);
}

export function createLoginThrottleMiddleware(deps: LoginThrottleMiddlewareDeps = {}) {
  const throttle = deps.throttle ?? loginThrottle;

  return function loginThrottleMiddleware(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || 'unknown';
    const key = keyOf(ip, normalizeLoginId((req.body as { login_id?: unknown } | undefined)?.login_id));
    req.loginThrottleKey = key;

    const verdict = throttle.check(key);
    if (!verdict.blocked) { next(); return; }

    // ★ 本文に login_id や「存在するか」を書かない (429 自体が判別材料にならないよう、
    //   文面は失敗回数だけに触れる)
    res.set('Retry-After', String(verdict.retryAfterSec));
    res.status(429).json({ error: E.AUTH_TOO_MANY_ATTEMPTS, retry_after: verdict.retryAfterSec });
  };
}

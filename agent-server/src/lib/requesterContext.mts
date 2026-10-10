/**
 * #564 AI が読める部屋を「頼んだ人が入っている部屋」に絞る — 依頼した人を処理の流れに持たせる。
 *
 * ★ 依頼した人 = その便を投稿した人 (dispatcher が runAsRequester で包む)。% 委譲は委譲を頼んだ人。
 * ★ 部屋ごとの待ち行列 (enqueueForRoom) に積んだ処理は、あとで別の流れから呼ばれる。積むときに
 *   withCurrentRequester で包まないと、依頼した人が途中で失われる (= 絞りが外れて今までどおりに戻る)。
 * ★ 道具 (tealus-mcp) には、依頼ごとの使い捨ての鍵を付けた中継の URL を渡す (routes/scopedProxy.mts)。
 *   鍵は推測できない長さで、期限 (既定 15 分 = 1 回の依頼の上限より長い) を過ぎたら引けない。
 * 設計: docs/03「AI が読める部屋は『頼んだ人が入っている部屋』だけ」
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import * as config from '../config.mts';

const als = new AsyncLocalStorage<{ requesterId: string }>();

export function runAsRequester<T>(requesterId: string | null | undefined, fn: () => T): T {
  return requesterId ? als.run({ requesterId }, fn) : fn();
}

export function currentRequester(): string | null {
  return als.getStore()?.requesterId ?? null;
}

/** 今の依頼した人を、あとで別の流れから呼ばれる処理に持たせる (待ち行列に積むとき) */
export function withCurrentRequester<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const requesterId = currentRequester();
  return (...args: A) => runAsRequester(requesterId, () => fn(...args));
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const tokens = new Map<string, { requesterId: string; expiresAt: number }>();

export function issueScopedToken(requesterId: string, { now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}): string {
  for (const [t, v] of tokens) if (v.expiresAt <= now) tokens.delete(t);   // 期限切れを掃除 (溜めない)
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { requesterId, expiresAt: now + ttlMs });
  return token;
}

export function requesterForToken(token: string, now = Date.now()): string | null {
  const v = tokens.get(token);
  return v && v.expiresAt > now ? v.requesterId : null;
}

/**
 * ★ 道具 (tealus-mcp) の接続先。依頼した人がいれば agent-server の中継 (使い捨ての鍵つき) に向け、
 *   中継が X-Tealus-Requester を付けて本体へ流す。依頼した人がいなければ今までどおり本体へ直接。
 *   Light v2 / Deep codex (lightV2.mts) と Deep claude (deep.mts) の両方がここを使う
 */
export function tealusApiUrlForCurrentRequester(): string {
  const requesterId = currentRequester();
  return requesterId ? `http://127.0.0.1:${config.PORT}/tealus-scoped/${issueScopedToken(requesterId)}` : config.TEALUS_API_URL;
}

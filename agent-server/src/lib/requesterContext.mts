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

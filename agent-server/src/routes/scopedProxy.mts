/**
 * #564 中継 /tealus-scoped/<鍵>/… → 本体 (TEALUS_API_URL)/… に X-Tealus-Requester: <依頼した人> を付けて流す。
 *
 * ★ AI の道具 (tealus-mcp) の接続先を依頼ごとにここへ向ける (lightV2.mts の buildLightV2McpConfig)。
 *   tealus-mcp 自身は変えない (本体の URL の代わりにこの URL を受け取るだけ)。
 * ★ 呼び出し側が付けた X-Tealus-Requester は捨て、鍵の人に置き換える。資格 (Authorization) は足さない
 *   = この中継を知っていても、本体へ直接呼ぶより広くは何もできない
 * ★ 本文はそのまま流す (express.json より前に置く。添付の送信も通す)
 */
import express from 'express';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { requesterForToken } from '../lib/requesterContext.mts';
import { logger } from '../lib/logger.mts';

const HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'x-tealus-requester', 'keep-alive', 'upgrade']);

export function createScopedProxy({ upstream }: { upstream: () => string }): express.Router {
  const router = express.Router();
  router.use('/:token', async (req: Request, res: Response) => {
    // ★ 道具は agent-server と同じマシンで動く。外からは受けない (本体の /agent-api 中継経由でも届かせない)
    const from = req.socket.remoteAddress || '';
    // ★★ 本体の /agent-api も localhost から届くので、それだけでは足りない。Cloudflare / nginx が付ける印があれば外から来たもの
    //   (本体側も /agent-api/tealus-scoped を断っている。2 重の守り)
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(from) || req.headers['x-forwarded-for'] || req.headers['cf-ray']) {
      res.status(403).json({ error: '中継は agent-server と同じマシンからだけ受けます' });
      return;
    }
    const requesterId = requesterForToken(String(req.params.token));
    if (!requesterId) {
      res.status(403).json({ error: '中継の鍵が無効です (期限切れ)' });
      return;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP.has(k.toLowerCase())) continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    headers.set('x-tealus-requester', requesterId);
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    try {
      const r = await fetch(`${upstream()}${req.url}`, {
        method: req.method,
        headers,
        ...(hasBody ? { body: Readable.toWeb(req) as unknown as BodyInit, duplex: 'half' } : {}),
      } as RequestInit);
      res.status(r.status);
      r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v); });
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      logger.warn(`[scoped-proxy] 本体へ流せませんでした: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) res.status(502).json({ error: '本体へ届きませんでした' });
    }
  });
  return router;
}

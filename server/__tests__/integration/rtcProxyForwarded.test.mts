/**
 * 本体の /rtc 中継は、取り次いだ印 (X-Forwarded-For) を付ける (2026-10-27 小野さん判断、昨日の D の続き)
 *
 * ★ rtc-server は「同じマシンから直接・中継の見出しが無い」接続を、古い読み上げの送りとして鍵なしで通す (wsAccess.mts)。
 *   中継が見出しを付けないと、社内 LAN から本体 (:3000) を直接開いた接続が「同じマシンから直接」に見え、鍵なしで入れた
 * ★ 中継先は env を入れてから app を読む (docs/05 §2a)
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;
let upstream: http.Server;
let seen: http.IncomingHttpHeaders | null = null;

beforeAll(async () => {
  upstream = http.createServer((req, res) => { seen = req.headers; res.end('ok'); });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  process.env.RTC_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ app } = require('../../src/app.mts') as { app: Express });
});
afterAll(async () => {
  delete process.env.RTC_URL;
  await new Promise<void>((r) => upstream.close(() => r()));
});

describe('/rtc の中継', () => {
  it('★★ 前段の見出しが無い要求にも X-Forwarded-For を付けて取り次ぐ', async () => {
    const res = await request(app).get('/rtc/health');
    expect(res.status).toBe(200);
    expect(seen?.['x-forwarded-for']).toBeTruthy();
  });
});

/**
 * リンクプレビューの取りに行き方 (2026-09-30)
 *
 * ★ 取りに行くのは外の宛先だけ。自分自身・LAN・リンクローカルには行かない (転送先も同じ)
 * ★ 読むのは HTML の頭だけ。上限を超えたら打ち切る。時間の打ち切りは本文の読み込みにも効かせる
 */
import http from 'http';
import type { AddressInfo } from 'net';

jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
} }));
jest.mock('../../src/db/pool.mts', () => ({ pool: { query: jest.fn() } }));

import { isPublicAddress, createOgpFetcher, fetchOgp, OGP_MAX_BYTES } from '../../src/services/linkPreview.mts';

const OG_HTML = '<html><head><meta property="og:title" content="タイトル"><meta property="og:description" content="説明"></head><body></body></html>';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.11.111',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:192.168.0.1',
  ])('%s は外ではない', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '142.250.196.110', '2001:4860:4860::8888'])('%s は外', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it('IP として読めないものは外として扱わない', () => {
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });
});

/** 手元にサーバを立てる。handler の中身はテストごとに差し替える */
let server: http.Server;
let base: string;
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('fetchOgp (既定) — 外でない宛先には行かない', () => {
  it('127.0.0.1 は取りに行かない (サーバに要求が届かない)', async () => {
    let hit = 0;
    handler = (_req, res) => { hit++; res.setHeader('Content-Type', 'text/html'); res.end(OG_HTML); };
    expect(await fetchOgp(`${base}/`)).toBeNull();
    expect(hit).toBe(0);
  });

  it('localhost (名前) も取りに行かない', async () => {
    let hit = 0;
    handler = (_req, res) => { hit++; res.setHeader('Content-Type', 'text/html'); res.end(OG_HTML); };
    const port = (server.address() as AddressInfo).port;
    expect(await fetchOgp(`http://localhost:${port}/`)).toBeNull();
    expect(hit).toBe(0);
  });

  it('http / https 以外は取りに行かない', async () => {
    expect(await fetchOgp('file:///C:/Windows/win.ini')).toBeNull();
  });
});

describe('createOgpFetcher — 転送先も同じ検査を通す', () => {
  it('外として許した宛先から、外でない宛先へ転送されたら止まる', async () => {
    const hits: string[] = [];
    handler = (req, res) => {
      hits.push(req.url || '');
      if (req.url === '/start') { res.statusCode = 302; res.setHeader('Location', 'http://10.255.255.1/'); res.end(); return; }
      res.setHeader('Content-Type', 'text/html'); res.end(OG_HTML);
    };
    // ★ 手元のサーバ (127.0.0.1) だけを「外」とみなす検査で試す
    const fetcher = createOgpFetcher({ isAllowed: (ip) => ip === '127.0.0.1' });
    expect(await fetcher(`${base}/start`)).toBeNull();
    expect(hits).toEqual(['/start']);
  });

  it('許された宛先どうしの転送は追う', async () => {
    handler = (req, res) => {
      if (req.url === '/start') { res.statusCode = 301; res.setHeader('Location', '/end'); res.end(); return; }
      res.setHeader('Content-Type', 'text/html'); res.end(OG_HTML);
    };
    const fetcher = createOgpFetcher({ isAllowed: (ip) => ip === '127.0.0.1' });
    expect(await fetcher(`${base}/start`)).toEqual({ title: 'タイトル', description: '説明', image_url: null });
  });

  it('転送は 3 回まで', async () => {
    let n = 0;
    handler = (_req, res) => { n++; res.statusCode = 302; res.setHeader('Location', `/r${n}`); res.end(); };
    const fetcher = createOgpFetcher({ isAllowed: (ip) => ip === '127.0.0.1' });
    expect(await fetcher(`${base}/r0`)).toBeNull();
    expect(n).toBe(4); // 最初の 1 回 + 転送 3 回
  });
});

describe('createOgpFetcher — 読む量と時間', () => {
  const fetcher = createOgpFetcher({ isAllowed: (ip) => ip === '127.0.0.1', timeoutMs: 500 });

  it('HTML でなければ読まない', async () => {
    handler = (_req, res) => { res.setHeader('Content-Type', 'video/mp4'); res.end(OG_HTML); };
    expect(await fetcher(`${base}/v.mp4`)).toBeNull();
  });

  it('上限を超える本文は、上限までで打ち切って頭の meta を読む', async () => {
    let written = 0;
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.write(OG_HTML.replace('</body></html>', ''));
      const chunk = 'x'.repeat(64 * 1024);
      const pump = () => {
        while (written < OGP_MAX_BYTES * 4) {
          written += chunk.length;
          if (!res.write(chunk)) { res.once('drain', pump); return; }
        }
        res.end();
      };
      pump();
    };
    expect(await fetcher(`${base}/big`)).toEqual({ title: 'タイトル', description: '説明', image_url: null });
  });

  it('本文がいつまでも終わらなくても、時間で打ち切る', async () => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.write('<html><head>'); // 頭だけ返して黙る
    };
    const t0 = Date.now();
    expect(await fetcher(`${base}/slow`)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

import { logger } from '../utils/logger.mts';
import { pool } from '../db/pool.mts';
import * as cheerio from 'cheerio';
import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { Server } from 'socket.io';

const URL_REGEX = /https?:\/\/[^\s<>"']+/g;

/** OGPメタデータ */
interface OgpData {
  title: string | null;
  description: string | null;
  image_url: string | null;
}

/** link_previewsテーブルの行 */
interface LinkPreviewRow {
  id: string;
  message_id: string;
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  created_at: Date;
}

/**
 * Extract URLs from message text
 */
export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.match(URL_REGEX) || [];
}

/**
 * 取りに行ってよい宛先か (2026-09-30)。外の宛先だけを許す。
 * ★ IP として読めないもの (名前のまま) は false —— 名前は必ず引いてから、引いた先の IP で判定する
 */
const NOT_PUBLIC = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) NOT_PUBLIC.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) NOT_PUBLIC.addSubnet(addr, prefix, 'ipv6');

export function isPublicAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 0) return false;
  // ★ IPv4 を埋めた IPv6 (::ffff:…) は全部外さない。BlockList に範囲で入れると、IPv4 の検査までこの範囲に当たって全部弾かれる
  if (v === 6 && /^::ffff:/i.test(ip)) return false;
  return !NOT_PUBLIC.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

/** HTML の頭だけ読む。OGP の meta は head にあるので、上限までで十分 */
export const OGP_MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

interface OgpFetcherOptions {
  /** 引いた先の IP を許すか。既定は外の宛先だけ (テストでは手元のサーバを許す) */
  isAllowed?: (ip: string) => boolean;
  timeoutMs?: number;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

/**
 * 接続する直前に、名前を引いた先の IP を検査する。
 * ★ 引いてから別途つなぐ形にすると、引いた後に向き先を変えられる。つなぐときに使う IP そのものを検査する
 */
function guardedAgent(isAllowed: (ip: string) => boolean): Agent {
  const lookup = (hostname: string, options: dns.LookupOptions, cb: LookupCallback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = addresses as dns.LookupAddress[];
      if (list.length === 0 || list.some((a) => !isAllowed(a.address))) {
        return cb(Object.assign(new Error(`外の宛先ではないため取りに行きません: ${hostname}`), { code: 'ENOTPUBLIC' }));
      }
      if (options.all) cb(null, list);
      else cb(null, list[0].address, list[0].family);
    });
  };
  return new Agent({ connect: { lookup: lookup as never } });
}

/** 本文を上限まで読む。途中で時間切れになったら、そこまでに読めた分を返す */
async function readHead(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // 時間切れ (abort) —— 読めた分で判定する
  } finally {
    reader.cancel().catch(() => {});
  }
  return text;
}

/**
 * OGP を取る関数を作る (2026-09-30)。
 * ★ 取りに行くのは外の宛先だけ。転送は自分で追い、転送先も同じ検査を通す (最大 3 回)
 * ★ 読むのは HTML の頭 (OGP_MAX_BYTES) まで。時間の打ち切りは本文の読み込みにも効く
 */
export function createOgpFetcher({ isAllowed = isPublicAddress, timeoutMs = 5000 }: OgpFetcherOptions = {}) {
  const dispatcher = guardedAgent(isAllowed);
  return async function fetchOgpGuarded(url: string): Promise<OgpData | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let current = new URL(url);
      for (let hop = 0; ; hop++) {
        if (current.protocol !== 'http:' && current.protocol !== 'https:') return null;
        // ★ IP をそのまま書いた宛先は名前を引かないので、ここで検査する
        const host = current.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(host) && !isAllowed(host)) {
          logger.info(`[link-preview] 外の宛先ではないため取りに行きません: ${host}`);
          return null;
        }
        const res = await undiciFetch(current, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Tealus/1.0 (Link Preview)' },
          redirect: 'manual',
          dispatcher,
        });
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel();
          if (hop >= MAX_REDIRECTS) return null;
          current = new URL(location, current);
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel();
          return null;
        }
        // ★ 形式が書かれていて HTML でなければ読まない (書かれていないものは読んでみる)
        const contentType = res.headers.get('content-type');
        if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          await res.body?.cancel();
          return null;
        }
        return parseOgp(await readHead(res.body as ReadableStream<Uint8Array> | null, OGP_MAX_BYTES));
      }
    } catch (err) {
      const e = err as { cause?: { code?: string }; message?: string };
      if (e.cause?.code === 'ENOTPUBLIC') {
        logger.info(`[link-preview] ${String(e.cause && (e.cause as Error).message)}`);
      } else {
        logger.error('OGP fetch error:', url, err instanceof Error ? err.message : String(err));
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };
}

/** Fetch OGP metadata from a URL */
export const fetchOgp = createOgpFetcher();

function parseOgp(html: string): OgpData | null {
  const $ = cheerio.load(html);

  const title = $('meta[property="og:title"]').attr('content')
    || $('meta[name="twitter:title"]').attr('content')
    || $('title').text()
    || null;

  const description = $('meta[property="og:description"]').attr('content')
    || $('meta[name="twitter:description"]').attr('content')
    || $('meta[name="description"]').attr('content')
    || null;

  const image_url = $('meta[property="og:image"]').attr('content')
    || $('meta[name="twitter:image"]').attr('content')
    || null;

  if (!title && !description) return null;

  return { title, description, image_url };
}

/**
 * Process link previews for a message (async, non-blocking)
 */
export async function processLinkPreviews(messageId: string, text: string | null | undefined, io: Server | null | undefined, roomId: string): Promise<void> {
  const urls = extractUrls(text);
  if (urls.length === 0) return;

  // Process first URL only (avoid spamming)
  const url = urls[0];

  try {
    const ogp = await fetchOgp(url);
    if (!ogp) return;

    const result = await pool.query<LinkPreviewRow>(
      `INSERT INTO link_previews (message_id, url, title, description, image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [messageId, url, ogp.title, ogp.description, ogp.image_url]
    );

    if (io) {
      io.to(roomId).emit('link:preview', {
        message_id: messageId,
        preview: result.rows[0],
      });
    }
  } catch (err) {
    logger.error('Link preview error:', err);
  }
}

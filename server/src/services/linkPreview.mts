import { logger } from '../utils/logger.mts';
import { pool } from '../db/pool.mts';
import * as cheerio from 'cheerio';
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
 * Fetch OGP metadata from a URL
 */
export async function fetchOgp(url: string): Promise<OgpData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Tealus/1.0 (Link Preview)' },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const html = await res.text();
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
  } catch (err) {
    logger.error('OGP fetch error:', url, err instanceof Error ? err.message : String(err));
    return null;
  }
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

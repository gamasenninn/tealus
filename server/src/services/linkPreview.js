const logger = require('../utils/logger');
const pool = require('../db/pool');
const cheerio = require('cheerio');

const URL_REGEX = /https?:\/\/[^\s<>"']+/g;

/**
 * Extract URLs from message text
 */
function extractUrls(text) {
  if (!text) return [];
  return text.match(URL_REGEX) || [];
}

/**
 * Fetch OGP metadata from a URL
 */
async function fetchOgp(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Linny/1.0 (Link Preview)' },
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
    logger.error('OGP fetch error:', url, err.message);
    return null;
  }
}

/**
 * Process link previews for a message (async, non-blocking)
 */
async function processLinkPreviews(messageId, text, io, roomId) {
  const urls = extractUrls(text);
  if (urls.length === 0) return;

  // Process first URL only (avoid spamming)
  const url = urls[0];

  try {
    const ogp = await fetchOgp(url);
    if (!ogp) return;

    const result = await pool.query(
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

module.exports = { extractUrls, fetchOgp, processLinkPreviews };

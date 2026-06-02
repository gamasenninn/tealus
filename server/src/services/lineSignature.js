/**
 * LINE Messaging API webhook signature verification
 *
 * X-Line-Signature header の HMAC-SHA256(channel_secret, raw_body) を verify。
 * timing-safe compare で side-channel attack 防止。
 *
 * 関連:
 *   - LINE 公式 docs: https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
 *   - LINE Bridge Phase 1 (#XXX、本日 Day 17 起票予定): Inbound 受信のみ
 *
 * @module services/lineSignature
 */
const crypto = require('crypto');

/**
 * LINE webhook signature を verify する
 *
 * @param {string} channelSecret - LINE Developers console から取得した channel secret
 * @param {string|Buffer} body - request raw body (= JSON.parse 前の bytes、HMAC 計算に必須)
 * @param {string} signature - X-Line-Signature header の値 (= Base64-encoded HMAC-SHA256)
 * @returns {boolean} true = 本物の LINE Platform 発、false = 偽 or 計算 mismatch
 */
function verifyLineSignature(channelSecret, body, signature) {
  if (!channelSecret || !signature) return false;
  if (body === undefined || body === null) return false;

  let expected;
  try {
    expected = crypto
      .createHmac('SHA256', channelSecret)
      .update(body)
      .digest('base64');
  } catch {
    return false;
  }

  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  // length 不一致は timingSafeEqual が throw する、事前 check
  if (signatureBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

module.exports = { verifyLineSignature };

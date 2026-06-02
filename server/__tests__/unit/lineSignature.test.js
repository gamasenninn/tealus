/**
 * LINE Signature verify unit test (#XXX LINE Bridge Phase 1)
 */
const crypto = require('crypto');
const { verifyLineSignature } = require('../../src/services/lineSignature');

const CHANNEL_SECRET = 'test-channel-secret-abc123';
const SAMPLE_BODY = JSON.stringify({
  destination: 'U1234567890',
  events: [
    {
      type: 'message',
      message: { type: 'text', id: 'msg1', text: 'hello' },
      source: { type: 'group', groupId: 'G1234' },
    },
  ],
});

function computeSignature(secret, body) {
  return crypto.createHmac('SHA256', secret).update(body).digest('base64');
}

describe('verifyLineSignature', () => {
  test('正しい signature で true', () => {
    const sig = computeSignature(CHANNEL_SECRET, SAMPLE_BODY);
    expect(verifyLineSignature(CHANNEL_SECRET, SAMPLE_BODY, sig)).toBe(true);
  });

  test('偽 signature (= 別 secret で計算) で false', () => {
    const sig = computeSignature('different-secret', SAMPLE_BODY);
    expect(verifyLineSignature(CHANNEL_SECRET, SAMPLE_BODY, sig)).toBe(false);
  });

  test('body 改ざんで false', () => {
    const sig = computeSignature(CHANNEL_SECRET, SAMPLE_BODY);
    const tamperedBody = SAMPLE_BODY.replace('hello', 'tampered');
    expect(verifyLineSignature(CHANNEL_SECRET, tamperedBody, sig)).toBe(false);
  });

  test('signature 空文字で false', () => {
    expect(verifyLineSignature(CHANNEL_SECRET, SAMPLE_BODY, '')).toBe(false);
  });

  test('channelSecret 未指定で false', () => {
    const sig = computeSignature(CHANNEL_SECRET, SAMPLE_BODY);
    expect(verifyLineSignature('', SAMPLE_BODY, sig)).toBe(false);
    expect(verifyLineSignature(null, SAMPLE_BODY, sig)).toBe(false);
  });

  test('Buffer body も accept (= raw bytes)', () => {
    const bodyBuf = Buffer.from(SAMPLE_BODY, 'utf8');
    const sig = computeSignature(CHANNEL_SECRET, bodyBuf);
    expect(verifyLineSignature(CHANNEL_SECRET, bodyBuf, sig)).toBe(true);
  });

  test('signature 長さ不一致で false (= timingSafeEqual throw 回避)', () => {
    expect(verifyLineSignature(CHANNEL_SECRET, SAMPLE_BODY, 'short')).toBe(false);
  });
});

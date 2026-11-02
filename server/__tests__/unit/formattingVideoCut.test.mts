/**
 * 動画の文字起こしが途中で切れていそうなら、整形後の本文の末尾に印を足す
 * (改善ループ 38、2026-11-02 小野さん判断 3「当面は切れたかもの印を付けるだけ」)
 */
const create = jest.fn();
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => create(...a) } } })) }));
const query = jest.fn();
jest.mock('../../src/db/pool.mts', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));
jest.mock('../../src/services/webhook.mts', () => ({ fireWebhooks: jest.fn() }));
jest.mock('../../src/utils/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { formatTranscription } from '../../src/services/formatting.mts';
import { VIDEO_CUT_NOTE } from '../../src/services/transcriptionConfig.mts';

const cutRaw = 'あ'.repeat(2600) + '川上さんが午前';

beforeEach(() => {
  create.mockReset().mockResolvedValue({ choices: [{ message: { content: '整えた本文。以上です。' } }] });
  query.mockReset().mockResolvedValue({ rows: [] });
});

test('★ 動画で切れていそうなら、整形後の本文の末尾に印を足して保存する', async () => {
  const out = await formatTranscription('m1', cutRaw, null, null, 1, 'video', 'legacy');
  expect(out).toBe('整えた本文。以上です。' + VIDEO_CUT_NOTE);
  const saved = query.mock.calls.find((c) => String(c[0]).includes("status = 'done', formatted_text"));
  expect(saved?.[1][0]).toBe('整えた本文。以上です。' + VIDEO_CUT_NOTE);
});

test('音声 (動画でない) には足さない', async () => {
  expect(await formatTranscription('m1', cutRaw, null, null, 1, 'voice', 'legacy')).toBe('整えた本文。以上です。');
});

test('動画でも、文が終わっていれば足さない', async () => {
  expect(await formatTranscription('m1', 'あ'.repeat(2600) + '以上です。', null, null, 1, 'video', 'legacy')).toBe('整えた本文。以上です。');
});

/**
 * 補正段 (organon モード) に部屋の直し例を載せる経路 (docs/15)。
 * ★ TRANSCRIPTION_ROOM_EXAMPLES=1 のときだけ。OFF の間は指示が今と 1 文字も変わらない
 */
const create = jest.fn();
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => create(...a) } } })) }));
const query = jest.fn();
jest.mock('../../src/db/pool.mts', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));
jest.mock('../../src/services/webhook.mts', () => ({ fireWebhooks: jest.fn() }));

import { formatTranscription } from '../../src/services/formatting.mts';
import { clearRoomExamplesCache } from '../../src/services/roomExamples.mts';

const now = Date.now();
const iso = (hAgo: number) => new Date(now - hAgo * 3600e3).toISOString();
// 人が直した便 25 (下限 20 を超える)。term は架空でなく辞書に無い語でもよい: 直した例は辞書の語が要るので、kept だけで例が立つ形にする
const edited = Array.from({ length: 25 }, (_, i) => ({ id: `e${i}`, created_at: iso(i + 1), raw: `整備場、取れますか。${i}`, ai: `整備場、取れますか。${i}`, human: `整備場、取れますか。はい${i}` }));

const systemOf = () => String(create.mock.calls[0][0].messages[0].content);

beforeEach(() => {
  clearRoomExamplesCache();
  create.mockReset().mockResolvedValue({ choices: [{ message: { content: '整えた本文。' } }] });
  query.mockReset().mockImplementation((sql: string) =>
    Promise.resolve({ rows: String(sql).includes('voice_transcriptions v1') ? edited : [] }));
});
afterEach(() => {
  delete process.env.TRANSCRIPTION_ROOM_EXAMPLES;
});

test('★ OFF (既定): 部屋の例を読まず、指示に載せない', async () => {
  await formatTranscription('m1', '整備場、取れますか', null, 'room-1', 1, 'voice', 'organon');
  expect(query.mock.calls.some((c) => String(c[0]).includes('voice_transcriptions v1'))).toBe(false);
  expect(systemOf()).not.toContain('このルームで人が直した例');
});

test('ON: organon モードで、部屋の例を指示の先頭に載せる', async () => {
  process.env.TRANSCRIPTION_ROOM_EXAMPLES = '1';
  await formatTranscription('m1', '整備場、取れますか', null, 'room-1', 1, 'voice', 'organon');
  expect(systemOf().startsWith('## このルームで人が直した例')).toBe(true);
  expect(query.mock.calls.find((c) => String(c[0]).includes('voice_transcriptions v1'))?.[1][0]).toBe('room-1');
});

test('ON でも、部屋の例が無ければ (直しが少ない部屋) 指示は OFF と同じ', async () => {
  await formatTranscription('m1', '整備場、取れますか', null, 'room-1', 1, 'voice', 'organon');
  const off = systemOf();
  create.mockClear();
  clearRoomExamplesCache();
  process.env.TRANSCRIPTION_ROOM_EXAMPLES = '1';
  query.mockImplementation(() => Promise.resolve({ rows: [] }));
  await formatTranscription('m1', '整備場、取れますか', null, 'room-1', 1, 'voice', 'organon');
  expect(systemOf()).toBe(off);
});

test('ON でも legacy モードには載せない', async () => {
  process.env.TRANSCRIPTION_ROOM_EXAMPLES = '1';
  await formatTranscription('m1', '整備場、取れますか', null, 'room-1', 1, 'voice', 'legacy');
  expect(systemOf()).not.toContain('このルームで人が直した例');
});

test('ON で例の読み込みが失敗しても、補正は例なしで続く', async () => {
  process.env.TRANSCRIPTION_ROOM_EXAMPLES = '1';
  query.mockImplementation((sql: string) => (String(sql).includes('voice_transcriptions v1') ? Promise.reject(new Error('db down')) : Promise.resolve({ rows: [] })));
  const out = await formatTranscription('m1', '整備場、取れますか', null, 'room-1', 1, 'voice', 'organon');
  expect(out).toBe('整えた本文。');
  expect(systemOf()).not.toContain('このルームで人が直した例');
});

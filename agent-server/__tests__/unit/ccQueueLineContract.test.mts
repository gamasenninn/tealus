/**
 * queue の 1 行の形を約束として固定する (docs/12 §4.1、配達役の段階 0、2026-11-19)
 *
 * ★ 配達役 (courier/) と受け手 (listen-tealus・handle-tealus) は、この形と id の形に頼る。
 *   以前は文書にもテストにもなっていなかった。形を変えるときは docs/12 §4.1 を先に直し、AI班連絡で全班に知らせる
 * ★ 新しい投稿 (message.created) と、編集で宛名を付け直した便 (message.updated) の両方の経路を見る
 *   (同じ id が 1 つの queue に 2 回入りうる。docs/12 §12.2)
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));
jest.mock('../../src/webhook/dispatcher.mts', () => ({ dispatch: jest.fn(async () => {}) }));
jest.mock('../../src/lib/botApi.mts', () => ({
  getRooms: jest.fn(async () => ({ rooms: [] })),
  pushStatus: jest.fn(async () => ({})),
}));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleWebhook, registerBotUserId } from '../../src/webhook/handler.mts';
import type { WebhookPayload } from '../../src/types.mts';

/** docs/12 §4.1 の id の形 (Tealus のメッセージの UUID)。courier/ 側にも同じ写しを置く (段階 1) */
const QUEUE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** docs/12 §4.1 の鍵の集合 */
const LINE_KEYS = ['content', 'created_at', 'id', 'recipients', 'room_id', 'room_name', 'sender', 'type'];
const SENDER_KEYS = ['display_name', 'id', 'role'];

const ROOM = { id: '5a33a62c-8bf0-41cf-a748-c76a38ef1c7f', name: '業務メモ' };
const SENDER = { id: '353c1076-5241-4542-bca8-9b259c47e5de', display_name: '甲野太郎', role: 'admin' };
const MSG_ID = 'c7016ebd-501d-404b-8747-78628e1c3638';

let dir: string;
const lines = (project: string) => fs.readFileSync(path.join(dir, `${project}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-contract-'));
  process.env.CC_QUEUE_DIR = dir;
  registerBotUserId('bot-assistant', 'アシスタント', [{ id: ROOM.id }]);
});
afterEach(() => {
  delete process.env.CC_QUEUE_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

function check(line: Record<string, unknown>) {
  expect(Object.keys(line).sort()).toEqual(LINE_KEYS);
  expect(Object.keys(line.sender as object).sort()).toEqual(SENDER_KEYS);
  expect(line.id).toMatch(QUEUE_ID_RE);
  expect(line.room_id).toMatch(QUEUE_ID_RE);
  expect(Array.isArray(line.recipients)).toBe(true);
  expect(typeof line.created_at).toBe('string');
}

describe('queue の 1 行の形 (docs/12 §4.1)', () => {
  it('★ 新しい投稿の経路', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: MSG_ID, content: '@cc-tealus 確かめ', type: 'text', sender: SENDER, created_at: '2026-11-19T07:30:13.323Z' },
      room: ROOM,
    } as unknown as WebhookPayload);
    const [line] = lines('tealus');
    check(line);
    expect(line).toMatchObject({ id: MSG_ID, room_id: ROOM.id, recipients: ['tealus'], created_at: '2026-11-19T07:30:13.323Z' });
  });

  it('★ 編集で宛名を付け直した経路 (同じ id がもう一度入る)', async () => {
    await handleWebhook({
      event: 'message.updated',
      message: { id: MSG_ID, content: '@cc-tealus 付け直し', previous_content: '付け直し', type: 'text', sender: SENDER, edited_by: SENDER, created_at: '2026-11-19T07:30:13.323Z' },
      room: ROOM,
    } as unknown as WebhookPayload);
    const [line] = lines('tealus');
    check(line);
    expect(line.id).toBe(MSG_ID);
  });

  it('作った時刻が無い便 (古い本体) でも created_at は文字で入る', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: MSG_ID, content: '@cc-tealus 時刻なし', type: 'text', sender: SENDER },
      room: ROOM,
    } as unknown as WebhookPayload);
    check(lines('tealus')[0]);
  });
});

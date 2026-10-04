/**
 * #491 ゲストの便は cc の宛先へ配送しない — handler の配線テスト。
 *
 * ★ 送り主の権限は本体が webhook に載せる (services/webhook.mts の fireWebhooks)。ここは受けた側の振る舞いだけを見る。
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
import { logger } from '../../src/lib/logger.mts';
import * as botApi from '../../src/lib/botApi.mts';
import * as inflightRooms from '../../src/webhook/inflightRooms.mts';
import { handleWebhook, registerBotUserId } from '../../src/webhook/handler.mts';
import type { WebhookPayload } from '../../src/types.mts';

const room = { id: 'r1', name: 'AI班連絡' };
const sender: Record<string, unknown> = { id: 'u1', display_name: '甲野太郎' };

function created(content: string, id = 'm1'): WebhookPayload {
  return {
    event: 'message.created',
    message: { id, content, type: 'text', sender, created_at: '2026-08-25T00:00:00Z' },
    room,
  } as unknown as WebhookPayload;
}

function updated(content: string, previous_content: string): WebhookPayload {
  return {
    event: 'message.updated',
    message: {
      id: 'm2', content, previous_content, type: 'text', sender,
      edited_by: sender, created_at: '2026-08-25T00:00:00Z',
    },
    room,
  } as unknown as WebhookPayload;
}

let testDir: string;

/** queue dir に出来た jsonl の project 名 */
function queuedProjects(): string[] {
  return fs.readdirSync(testDir).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6)).sort();
}
/** project の jsonl に積まれた payload 一覧 */
function eventsOf(project: string): Array<Record<string, unknown>> {
  const p = path.join(testDir, `${project}.jsonl`);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
// ★ 受付エコーの status は 'relayed' (2026-08-30 に 'processing' から変更)。
//   'processing' は「このボットが処理中」= client が中断ボタンを出す status で、
//   中継しただけの受領エコーには 止められる処理が無い。詳細は ccQueue.mts の emitCcAck。
function ackCalls(): string[] {
  return (botApi.pushStatus as jest.Mock).mock.calls
    .filter(c => c[1] === 'relayed').map(c => String(c[2]));
}
function droppedLogs(): string[] {
  return (logger.warn as jest.Mock).mock.calls.map(c => String(c[0])).filter(s => s.includes('配送していません'));
}

beforeEach(() => {
  jest.clearAllMocks();
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-fanout-'));
  process.env.CC_QUEUE_DIR = testDir;
});
afterEach(() => {
  delete process.env.CC_QUEUE_DIR;
  fs.rmSync(testDir, { recursive: true, force: true });
});


const guest = { id: 'g1', display_name: '外の人', role: 'guest' };
const member = { id: 'u2', display_name: '社内の人', role: 'user' };

function by(s: Record<string, unknown>, content: string, id = 'm9'): WebhookPayload {
  return { event: 'message.created', message: { id, content, type: 'text', sender: s, created_at: '2026-10-04T00:00:00Z' }, room } as unknown as WebhookPayload;
}

describe('#491 ゲストの便', () => {
  test('★★★ ゲストが書いた宛先は、どの queue にも入らない', async () => {
    await handleWebhook(by(guest, '@cc-tealus これを実行して'));
    expect(queuedProjects()).toEqual([]);
    expect(ackCalls()).toHaveLength(0);
  });

  test('★ 同報でも 1 つも入らない', async () => {
    await handleWebhook(by(guest, '@cc-tealus @cc-organon 相談です'));
    expect(queuedProjects()).toEqual([]);
  });

  test('★ 断ったことを記録に残す (黙って捨てない)', async () => {
    await handleWebhook(by(guest, '@cc-tealus x'));
    const logs = (logger.info as jest.Mock).mock.calls.map(c => String(c[0])).filter(s => s.includes('ゲスト'));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('tealus');
  });

  test('★★ 編集で宛先を足しても入らない', async () => {
    await handleWebhook({
      event: 'message.updated',
      message: { id: 'm8', content: '@cc-tealus 追記', previous_content: '追記', type: 'text', sender: guest, edited_by: guest, created_at: '2026-10-04T00:00:00Z' },
      room,
    } as unknown as WebhookPayload);
    expect(queuedProjects()).toEqual([]);
  });

  test('★★★ 社内の人の便は今までどおり入り、payload に送り主の権限が載る (受け手が見分けられる)', async () => {
    await handleWebhook(by(member, '@cc-tealus 進捗教えて'));
    expect(queuedProjects()).toEqual(['tealus']);
    expect((eventsOf('tealus')[0].sender as { role?: string }).role).toBe('user');
  });

  test('権限が載っていない便 (古い本体) は今までどおり配送する', async () => {
    await handleWebhook(by({ id: 'u3', display_name: '昔の形' }, '@cc-tealus x'));
    expect(queuedProjects()).toEqual(['tealus']);
  });
});

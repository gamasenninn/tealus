/**
 * #387 同報 (複数配送) + #386 捨てた宛先の可視化 — handler の配線テスト。
 *
 * 判別ロジック本体は ccQueue.test.mts (extractCcProjects / findDroppedCcMentions)。
 * ここで見るのは **配線** だけ:
 *   - 宛先の数だけ jsonl が出来る
 *   - 受付エコーは 1 回にまとめる (宛先ごとに push すると上書きし合う)
 *   - payload に配送先一覧 (recipients) が載る
 *   - 編集で増えた宛先にだけ配る (既に届いた班へ二重配送しない)
 *
 * ★ 判定そのものを二重に書かない (handlerCcUnrouted.test.mts と同じ stance)。
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
import { handleWebhook } from '../../src/webhook/handler.mts';
import type { WebhookPayload } from '../../src/types.mts';

const room = { id: 'r1', name: 'AI班連絡' };
const sender = { id: 'u1', display_name: '甲野太郎' };

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
function ackCalls(): string[] {
  return (botApi.pushStatus as jest.Mock).mock.calls
    .filter(c => c[1] === 'processing').map(c => String(c[2]));
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

describe('#387 message.created の同報', () => {
  test('★ 実害ケース: 3 宛先を並べた便が 3 つの queue に入る (2026-08-23 16:59 の形)', async () => {
    await handleWebhook(created('@cc-tealus @cc-organon @cc-kairos\n\n【LP班】相談です'));

    expect(queuedProjects()).toEqual(['kairos', 'organon', 'tealus']);
    for (const p of ['tealus', 'organon', 'kairos']) {
      expect(eventsOf(p)).toHaveLength(1);
      expect(eventsOf(p)[0].id).toBe('m1');
    }
  });

  test('★★ 受付エコーは 1 回だけ、宛先を全部載せる (宛先ごとに push すると上書きし合う)', async () => {
    await handleWebhook(created('@cc-tealus @cc-organon @cc-kairos 相談です'));

    const acks = ackCalls();
    expect(acks).toHaveLength(1);
    expect(acks[0]).toContain('tealus');
    expect(acks[0]).toContain('organon');
    expect(acks[0]).toContain('kairos');
  });

  test('★ payload に配送先一覧が載る (受け手が「N 班に配られた」と分かる)', async () => {
    await handleWebhook(created('@cc-tealus @cc-organon 相談です'));

    expect(eventsOf('organon')[0].recipients).toEqual(['tealus', 'organon']);
    expect(eventsOf('tealus')[0].recipients).toEqual(['tealus', 'organon']);
  });

  test('★★★ 従来の単一宛先は挙動が変わらない (1 file / ack 1 回 / recipients は自分だけ)', async () => {
    await handleWebhook(created('@cc-tealus 進捗教えて'));

    expect(queuedProjects()).toEqual(['tealus']);
    expect(ackCalls()).toHaveLength(1);
    expect(eventsOf('tealus')[0].recipients).toEqual(['tealus']);
    expect(droppedLogs()).toHaveLength(0);
  });

  test('★★★ 1 行目以外の行頭 mention は配送されない (2026-08-20 の案内表で 7 班を起こさない)', async () => {
    const guide = '@cc-tealus-dev 【本体班 → Mac セッション】本題\n\n@cc-organon ← 説明\n@cc-kairos ← 説明';
    await handleWebhook(created(guide));

    expect(queuedProjects()).toEqual(['tealus-dev']);
  });

  test('★ #386 配送しなかった宛先は黙って捨てず warn に出す', async () => {
    const guide = '@cc-tealus-dev 本題\n\n@cc-organon ← 説明\n@cc-kairos ← 説明';
    await handleWebhook(created(guide));

    const logs = droppedLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('organon');
    expect(logs[0]).toContain('kairos');
    expect(logs[0]).toContain('tealus-dev');   // 配送した先も分かる
  });

  test('★ 宛先ゼロの便では何も起きない (#359 の経路を壊さない)', async () => {
    await handleWebhook(created('今日の朝礼のメモです'));

    expect(queuedProjects()).toEqual([]);
    expect(ackCalls()).toHaveLength(0);
    expect(droppedLogs()).toHaveLength(0);
  });
});

describe('#387 message.updated (編集で宛先を足した場合)', () => {
  test('★★★ 増えた宛先にだけ配る — 既に届いている班へ二重配送しない', async () => {
    await handleWebhook(updated(
      '@cc-tealus @cc-organon 相談です',   // 編集後
      '@cc-tealus 相談です',                // 編集前 (tealus には既に届いている)
    ));

    expect(queuedProjects()).toEqual(['organon']);
    expect(eventsOf('organon')).toHaveLength(1);
  });

  test('★ 受付エコーも増えた分だけ、1 回', async () => {
    await handleWebhook(updated('@cc-tealus @cc-organon 相談', '@cc-tealus 相談'));

    const acks = ackCalls();
    expect(acks).toHaveLength(1);
    expect(acks[0]).toContain('organon');
    expect(acks[0]).not.toContain('tealus');
  });

  test('★ 宛先が変わっていなければ配らない (本文だけ直した編集で再送しない)', async () => {
    await handleWebhook(updated('@cc-tealus 相談です (訂正)', '@cc-tealus 相談です'));

    expect(queuedProjects()).toEqual([]);
    expect(ackCalls()).toHaveLength(0);
  });

  test('★ 宛先ゼロ → 宛先ありの新規付与は従来どおり配る', async () => {
    await handleWebhook(updated('@cc-tealus 呼び忘れました', '呼び忘れました'));

    expect(queuedProjects()).toEqual(['tealus']);
  });
});

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
import * as inflightRooms from '../../src/webhook/inflightRooms.mts';
import { handleWebhook, registerBotUserId } from '../../src/webhook/handler.mts';
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

/**
 * #392 アカウント共有で起きる取りこぼし。
 *
 * cc セッションがアプリ内アシスタントと **同じ Tealus アカウント**を使っていると、
 * その部屋が inflight (アシスタントが応答中) の間、**cc の便が配送前に落ちる**。
 * skip は `botUserIds.has(senderId)` かつ inflight でだけ起きる (`handler.mts`) ので、
 * ★ **投稿が自送 echo か第三者の便かは条件に入っていない** —— そこが取りこぼしの正体。
 *
 * ★ この 2 本は「同じ便・同じ部屋・同じ inflight の窓で、**アカウントだけ違う**」対照。
 *   2026-08-25 の実機検証では、実測できたのは下側 (通る方) だけで、
 *   上側 (消える方) は **コードからの演繹**だった。ここで演繹を実行可能な形に固定する。
 */
describe('#392 bot account を共有していると inflight 中の便が消える', () => {
  const sharedBot = { id: 'shared-bot-account', display_name: '共有アカウント' };

  beforeEach(() => {
    process.env.ENABLE_CROSS_ROOM_DELEGATION = 'true';
    inflightRooms._reset();
    registerBotUserId(sharedBot.id);       // = アプリ内アシスタントとして登録済みの状態
    inflightRooms.add(room.id);            // = その部屋でアシスタントが応答中
  });
  afterEach(() => {
    delete process.env.ENABLE_CROSS_ROOM_DELEGATION;
    inflightRooms._reset();
  });

  test('★★★ 共有アカウントから投げると、配送されず warn も出ない (痕跡が残らない)', async () => {
    await handleWebhook({
      event: 'message.created',
      message: {
        id: 'm-shared', content: '@cc-tealus 検証便です', type: 'text',
        sender: sharedBot, created_at: '2026-08-25T07:24:17Z',
      },
      room,
    } as unknown as WebhookPayload);

    expect(queuedProjects()).toEqual([]);     // ★ 消える
    expect(ackCalls()).toHaveLength(0);       // 受付エコーも出ない = 送信者にも見えない
    expect(droppedLogs()).toHaveLength(0);    // ★ #386 の warn にも掛からない (配送前に return するため)
  });

  test('★★★ まったく同じ便でも、専用アカウントなら配送される (アカウントだけが違い)', async () => {
    // created() の送信者 u1 = bot 登録なし = 分離後の cc セッション
    await handleWebhook(created('@cc-tealus 検証便です', 'm-own'));

    expect(queuedProjects()).toEqual(['tealus']);
    expect(ackCalls()).toHaveLength(1);
  });
});

/**
 * #359 (a) 配送されなかった便の可視化 — handler の配線テスト。
 *
 * 判別ロジック本体は ccQueue.test.mts (detectUnroutedAddressHint) にある。
 * ここで見るのは **配線** だけ:
 *   - routing された便では鳴らない (else に入らない)
 *   - routing されず、宛先を書いたように見える便で info が 1 行出る
 *   - 普通の会話では鳴らない
 *
 * ★ 判定そのものを二重に書かない。ここで条件を書き足すと、実装が 2 か所に増える。
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
import { dispatch } from '../../src/webhook/dispatcher.mts';
import { handleWebhook } from '../../src/webhook/handler.mts';
import type { WebhookPayload } from '../../src/types.mts';

const room = { id: 'r1', name: 'AI班連絡' };
const sender = { id: 'u1', display_name: '小野哲' };

function payload(content: string): WebhookPayload {
  return {
    event: 'message.created',
    message: { id: 'm1', content, type: 'text', sender, created_at: '2026-08-21T00:00:00Z' },
    room,
  } as unknown as WebhookPayload;
}

/** [cc-queue] 宛先未解決 の info だけを取り出す */
function unroutedLogs(): string[] {
  return (logger.info as jest.Mock).mock.calls
    .map(c => String(c[0]))
    .filter(s => s.includes('宛先未解決'));
}

describe('#359 (a) handler の配線', () => {
  let testDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    // ★ 本番 ~/.tealus/cc-queue を掴まないよう隔離 (routing が成立する経路を通るテストがある)
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-unrouted-'));
    process.env.CC_QUEUE_DIR = testDir;
  });

  afterEach(() => {
    delete process.env.CC_QUEUE_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('★ 実害ケース: 宛先を書いたのに mention が無い便で info が 1 行出る', async () => {
    await handleWebhook(payload('【organon班 → 本体班】🔴 6 件目、閾値に到達しました'));

    const logs = unroutedLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('team-arrow');
    expect(logs[0]).toContain('AI班連絡');       // どの room か
    expect(logs[0]).toContain('小野哲');          // 誰が出したか
    expect(logs[0]).toContain('6 件目');          // 本文の頭 (どの便か特定できる)
  });

  test('★ routing された便では鳴らない', async () => {
    await handleWebhook(payload('@cc-tealus 【organon班 → 本体班】本題'));

    expect(unroutedLogs()).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Routed @cc-tealus'));
  });

  test('★★ 普通の会話では鳴らない', async () => {
    await handleWebhook(payload('今日の朝礼のメモです'));

    expect(unroutedLogs()).toHaveLength(0);
  });

  test('★ 行頭 @cc- だが project 名が規約外の便も拾う', async () => {
    await handleWebhook(payload('@cc-Tealus 進捗どう'));

    const logs = unroutedLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('malformed-cc-mention');
  });

  test('★ 配送されなくても dispatch は止めない (アシスタント応答の経路を壊さない)', async () => {
    await handleWebhook(payload('【organon班 → 本体班】本題'));

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

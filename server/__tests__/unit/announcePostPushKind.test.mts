/**
 * 配信 (message:new) に通知の扱い (push_kind) を添える (2026-10-08)
 *
 * ★ 画面の中の音を、プッシュと同じ判定にそろえるため (docs/07 ②)。
 *   それまで画面は「機械の投稿か」を知らず、プッシュを鳴らさない機械の投稿でも音を鳴らしていた
 * ★ 判定は経路ごとに違う (LINE の文字は human、写真は machine) ので、送り手の is_bot では代わりにならない
 */
jest.mock('../../src/services/machinePush.mts', () => ({ pushMachinePost: jest.fn(async () => {}) }));
jest.mock('../../src/services/push.mts', () => ({ sendPushToRoomMembers: jest.fn(async () => {}) }));
jest.mock('../../src/services/webhook.mts', () => ({ fireWebhooks: jest.fn() }));
jest.mock('../../src/services/linkPreview.mts', () => ({ processLinkPreviews: jest.fn(async () => {}) }));

import type { Server } from 'socket.io';
import { announcePost, SYSTEM_MESSAGE_EFFECTS, type PostEffects } from '../../src/services/postEffects.mts';

function fakeIo() {
  const sent: Array<Record<string, unknown>> = [];
  const io = { to: () => ({ emit: (_ev: string, m: Record<string, unknown>) => { sent.push(m); } }) } as unknown as Server;
  return { io, sent };
}

const base = (io: Server): Omit<PostEffects, 'push'> => ({
  roomId: 'room-1', io, emit: { id: 'm1', content: 'こんにちは' },
  webhook: { kind: 'off', reason: 'test' }, preview: { kind: 'off', reason: 'test' },
});

describe('announcePost: 配信に push_kind を添える', () => {
  it('人の投稿は human', async () => {
    const { io, sent } = fakeIo();
    await announcePost({ ...base(io), push: { kind: 'human', senderId: 'u', payload: { title: 't' } } });
    expect(sent[0]).toEqual({ id: 'm1', content: 'こんにちは', push_kind: 'human' });
  });

  it('★ 機械の投稿は machine', async () => {
    const { io, sent } = fakeIo();
    await announcePost({ ...base(io), push: { kind: 'machine', post: { roomId: 'room-1', senderId: 'b', senderName: 'ボット', messageId: 'm1', body: 'b' } } });
    expect(sent[0].push_kind).toBe('machine');
  });

  it('system メッセージは off', async () => {
    const { io, sent } = fakeIo();
    await announcePost({ ...base(io), ...SYSTEM_MESSAGE_EFFECTS });
    expect(sent[0].push_kind).toBe('off');
  });

  it('★ 呼び出し側が渡した中身は書き換えない (同じ object を他でも使っている経路がある)', async () => {
    const { io } = fakeIo();
    const emit = { id: 'm1' };
    await announcePost({ ...base(io), emit, push: { kind: 'human', senderId: 'u', payload: { title: 't' } } });
    expect(emit).toEqual({ id: 'm1' });
  });
});

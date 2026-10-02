/**
 * 投稿が届いたときに通知音を鳴らすか (2026-10-02)
 *
 * ★ それまでは「自分以外の投稿なら鳴らす」で、入退室・通話の開始/終了などの system メッセージでも鳴っていた。
 *   system メッセージは中央に小さく出す (SystemMessage) ので、音も鳴らさない (利用者判断)
 * ★ 判定は useSocketSync (開いている部屋) と RoomList (部屋の一覧) の 2 か所で同じものを使う
 *   (同じ条件を 2 か所に書くと、片方だけ直る)
 */
import { describe, it, expect } from 'vitest';
import { shouldPlayMessageSound } from '../src/utils/messageSound';

const ME = 'me';

describe('shouldPlayMessageSound', () => {
  it('ほかの人の投稿は鳴らす', () => {
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'text' }, ME, 'on')).toBe(true);
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'stamp' }, ME, null)).toBe(true);
  });
  it('自分の投稿は鳴らさない (別の端末でも)', () => {
    expect(shouldPlayMessageSound({ sender_id: ME, type: 'text' }, ME, 'on')).toBe(false);
  });
  it('★ system メッセージは鳴らさない', () => {
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'system' }, ME, 'on')).toBe(false);
  });
  it('通知音を切っていれば鳴らさない', () => {
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'text' }, ME, 'off')).toBe(false);
  });
});

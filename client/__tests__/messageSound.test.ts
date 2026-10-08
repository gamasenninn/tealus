/**
 * 投稿が届いたときに通知音を鳴らすか (2026-10-02)
 *
 * ★ それまでは「自分以外の投稿なら鳴らす」で、入退室・通話の開始/終了などの system メッセージでも鳴っていた。
 *   system メッセージは中央に小さく出す (SystemMessage) ので、音も鳴らさない (利用者判断)
 * ★ 判定は部屋の一覧 (RoomList) だけが使う (#505 以前は開いている部屋でも鳴らしていた)
 * ★ 2026-10-08: 通知音の設定はアカウントごとになった (users.notification_sound)。
 *   「このルームの通知」を切った部屋も鳴らさない (それまではプッシュにしか効かず「切ったのに鳴る」と言われた)
 */
import { describe, it, expect } from 'vitest';
import { shouldPlayMessageSound, shouldMoveLegacySoundOff } from '../src/utils/messageSound';

const ME = 'me';
const ON = { soundOn: true, roomMuted: false, machinePostsRing: false };

describe('shouldPlayMessageSound', () => {
  it('ほかの人の投稿は鳴らす', () => {
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'text' }, ME, ON)).toBe(true);
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'stamp' }, ME, ON)).toBe(true);
  });
  it('自分の投稿は鳴らさない (別の端末でも)', () => {
    expect(shouldPlayMessageSound({ sender_id: ME, type: 'text' }, ME, ON)).toBe(false);
  });
  it('★ system メッセージは鳴らさない', () => {
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'system' }, ME, ON)).toBe(false);
  });
  it('通知音を切っていれば鳴らさない', () => {
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'text' }, ME, { ...ON, soundOn: false })).toBe(false);
  });
  it('★★ 「このルームの通知」を切った部屋は鳴らさない', () => {
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'text' }, ME, { ...ON, roomMuted: true })).toBe(false);
  });
  // ★ 2026-10-08 プッシュと同じ判定にそろえる (docs/07 ②)。サーバーが配信に push_kind を添える
  it('★★ 機械の投稿は、ルームが「機械の投稿でも鳴らす」でなければ鳴らさない', () => {
    expect(shouldPlayMessageSound({ sender_id: 'bot', type: 'text', push_kind: 'machine' }, ME, ON)).toBe(false);
    expect(shouldPlayMessageSound({ sender_id: 'bot', type: 'text', push_kind: 'machine' }, ME, { ...ON, machinePostsRing: true })).toBe(true);
  });
  it('人の投稿は、ルームの機械の設定に関係なく鳴らす', () => {
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'text', push_kind: 'human' }, ME, ON)).toBe(true);
  });
  it('プッシュを付けない配信 (off) は鳴らさない', () => {
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'text', push_kind: 'off' }, ME, ON)).toBe(false);
  });
  it('push_kind の無い配信 (古いサーバー) は従来どおり鳴らす', () => {
    expect(shouldPlayMessageSound({ sender_id: 'other', type: 'text' }, ME, ON)).toBe(true);
  });
});

describe('shouldMoveLegacySoundOff (端末に残った「切る」をアカウントへ移すか)', () => {
  it('★ 端末で切っていて、アカウントはまだ鳴らす → 移す', () => {
    expect(shouldMoveLegacySoundOff({ notification_sound: true }, 'off')).toBe(true);
  });
  it('アカウントでもう切っている → 移さない', () => {
    expect(shouldMoveLegacySoundOff({ notification_sound: false }, 'off')).toBe(false);
  });
  it('端末で切っていない ("on" / 何も無い) → 移さない', () => {
    expect(shouldMoveLegacySoundOff({ notification_sound: true }, 'on')).toBe(false);
    expect(shouldMoveLegacySoundOff({ notification_sound: true }, null)).toBe(false);
  });
  it('サーバーが古くて設定を返さない → 移さない (送っても 400 で保存されない)', () => {
    expect(shouldMoveLegacySoundOff({}, 'off')).toBe(false);
  });
});

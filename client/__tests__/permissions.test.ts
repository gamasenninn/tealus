import { describe, it, expect } from 'vitest';
import { isAdmin, isGuest, canCreateRoom, canInviteToRoom, canCreateStamp, canDeleteRoomTag, canSearchUsers, roleLabel, canEditTranscription } from '../src/utils/permissions';

describe('client permissions helper (#282 Phase D)', () => {
  const admin = { role: 'admin' };
  const user = { role: 'user' };
  const guest = { role: 'guest' };
  const bot = { role: 'user', is_bot: true };

  it('isAdmin / isGuest が role を正しく判定', () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(user)).toBe(false);
    expect(isGuest(guest)).toBe(true);
    expect(isGuest(user)).toBe(false);
    expect(isGuest(null)).toBe(false);
  });

  it('★ #496 canDeleteRoomTag: 作った人 / 部屋の管理者 / システム管理者だけ', () => {
    const tag = { created_by: 'u-maker' };
    expect(canDeleteRoomTag(tag, { id: 'u-maker', role: 'user' }, 'member')).toBe(true);
    expect(canDeleteRoomTag(tag, { id: 'u-x', role: 'user' }, 'admin')).toBe(true);
    expect(canDeleteRoomTag(tag, { id: 'u-x', role: 'admin' }, 'member')).toBe(true);
    expect(canDeleteRoomTag(tag, { id: 'u-x', role: 'user' }, 'member')).toBe(false);
    expect(canDeleteRoomTag(tag, { id: 'u-x', role: 'guest' }, 'member')).toBe(false);
    expect(canDeleteRoomTag({ created_by: null }, { id: 'u-x', role: 'user' }, 'member')).toBe(false);
    expect(canDeleteRoomTag(tag, null, undefined)).toBe(false);
  });

  it('★ #495 canCreateStamp は guest のみ false (送るだけ)', () => {
    expect(canCreateStamp(admin)).toBe(true);
    expect(canCreateStamp(user)).toBe(true);
    expect(canCreateStamp(guest)).toBe(false);
  });

  it('canCreateRoom / canInviteToRoom は guest のみ false', () => {
    expect(canCreateRoom(admin)).toBe(true);
    expect(canCreateRoom(user)).toBe(true);
    expect(canCreateRoom(guest)).toBe(false);
    expect(canInviteToRoom(guest)).toBe(false);
    expect(canInviteToRoom(user)).toBe(true);
  });

  // ★ #575 ゲストは利用者の一覧・オンラインを引けない (サーバーの canSearchUsers と同じ)。
  //   画面が毎回 GET /api/users/online を呼んで 403 を積んでいた
  it('canSearchUsers は admin / user だけ true (サーバーと同じ)', () => {
    expect(canSearchUsers(admin)).toBe(true);
    expect(canSearchUsers(user)).toBe(true);
    expect(canSearchUsers(guest)).toBe(false);
    expect(canSearchUsers(null)).toBe(false);
  });

  it('roleLabel が日本語ラベルを返す (bot 優先)', () => {
    expect(roleLabel(admin)).toBe('管理者');
    expect(roleLabel(user)).toBe('一般');
    expect(roleLabel(guest)).toBe('ゲスト');
    expect(roleLabel(bot)).toBe('BOT');
  });
});

// ★ 改善ループ 14 回目: 会話モードはサーバがゲストを断る (403、10-23) のに、ボタンはゲストにも出ていた (押して初めて断られる)。
//   招待と同じく、機械も人の操作なので出さない (サーバは 10-23 から機械の招待も断っている)
import { canUseVoiceChat, canInviteToRoom as canInvite } from '../src/utils/permissions';
describe('canUseVoiceChat', () => {
  it('社員・管理者は使える / ゲストは使えない', () => {
    expect(canUseVoiceChat({ role: 'user' })).toBe(true);
    expect(canUseVoiceChat({ role: 'admin' })).toBe(true);
    expect(canUseVoiceChat({ role: 'guest' })).toBe(false);
    expect(canUseVoiceChat(null)).toBe(false);
  });
  it('招待も機械には出さない (サーバと揃える)', () => {
    expect(canInvite({ role: 'user', is_bot: true })).toBe(false);
  });
});

// ★ 2026-10-27: 文字起こしを直せるか (本体の routes/transcription.mts と同じ)。画面の 2 か所 (吹き出しのボタン・メニュー) が別々に書いていたのを 1 つに
describe('canEditTranscription', () => {
  it('本人は直せる (ゲストでも自分の音声は直せる)', () => {
    expect(canEditTranscription({ isOwn: true, isGuest: true, allowMemberEdit: false, senderIsBot: false })).toBe(true);
  });
  it('メンバーは、設定がオンか、機械の音声なら直せる', () => {
    expect(canEditTranscription({ isOwn: false, isGuest: false, allowMemberEdit: true, senderIsBot: false })).toBe(true);
    expect(canEditTranscription({ isOwn: false, isGuest: false, allowMemberEdit: false, senderIsBot: true })).toBe(true);
    expect(canEditTranscription({ isOwn: false, isGuest: false, allowMemberEdit: false, senderIsBot: false })).toBe(false);
  });
  it('★ ゲストは他の人の音声を直せない (設定がオンでも・機械の音声でも)', () => {
    expect(canEditTranscription({ isOwn: false, isGuest: true, allowMemberEdit: true, senderIsBot: true })).toBe(false);
  });
});

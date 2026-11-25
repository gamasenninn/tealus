/**
 * 改善ループ 113: 部屋の設定の保存 (PUT /api/rooms/:id) で、どの項目を受け、どれを断るか。
 * 道の中で項目ごとに SQL の断片を積んでいて、断る枝と「確かめずに通す」項目にテストが無かった。
 * ★ 今の動きをそのまま表にしている (確かめを足すのは動きの変更なので、ここではしない)。
 */
import { buildRoomUpdate, isValidRoomName, ROOM_NAME_MAX } from '../../src/services/roomUpdate.mts';

const admin = { isSystemAdmin: true };
const roomAdmin = { isSystemAdmin: false };

describe('buildRoomUpdate', () => {
  it('来た項目だけを、決まった順で列にする', () => {
    const r = buildRoomUpdate({ push_machine_posts: true, name: 'A', message_edit_policy: 'member' }, roomAdmin);
    expect(r).toEqual({ ok: true, sets: [['name', 'A'], ['message_edit_policy', 'member'], ['push_machine_posts', true]] });
  });

  it('配列の項目は JSON の文字列にする', () => {
    const r = buildRoomUpdate({ app_urls: [{ url: 'https://a.example' }], voice_conversation_tools: ['x'], voice_conversation_denied_tools: [] }, roomAdmin);
    expect(r).toEqual({ ok: true, sets: [
      ['app_urls', '[{"url":"https://a.example"}]'],
      ['voice_conversation_tools', '["x"]'],
      ['voice_conversation_denied_tools', '[]'],
    ] });
  });

  it('何も来なければ 400', () => {
    expect(buildRoomUpdate({}, roomAdmin)).toEqual({ ok: false, status: 400, error: '更新する項目がありません' });
  });

  it('知らない項目は無視する (来なかったのと同じ)', () => {
    expect(buildRoomUpdate({ created_by: 'x' }, roomAdmin).ok).toBe(false);
  });

  it('お知らせの切り替えはシステム管理者だけ (ほかの項目より先に断る)', () => {
    expect(buildRoomUpdate({ is_announcement: true, name: '' }, roomAdmin))
      .toEqual({ ok: false, status: 403, error: 'お知らせの切り替えはシステム管理者だけができます' });
    expect(buildRoomUpdate({ is_announcement: true }, admin)).toEqual({ ok: true, sets: [['is_announcement', true]] });
  });

  it('名前: 空・長すぎるは 400', () => {
    expect(buildRoomUpdate({ name: '  ' }, roomAdmin)).toMatchObject({ ok: false, status: 400 });
    expect(buildRoomUpdate({ name: 'あ'.repeat(ROOM_NAME_MAX + 1) }, roomAdmin)).toMatchObject({ ok: false, status: 400 });
  });

  it('アプリの URL: http(s) でなければ 400', () => {
    expect(buildRoomUpdate({ app_urls: [{ url: 'javascript:alert(1)' }] }, roomAdmin))
      .toEqual({ ok: false, status: 400, error: 'アプリの URL は http:// か https:// で始めてください' });
  });

  it('push_machine_posts: true / false 以外は 400', () => {
    expect(buildRoomUpdate({ push_machine_posts: 'yes' }, roomAdmin))
      .toEqual({ ok: false, status: 400, error: 'push_machine_posts は true / false で指定してください' });
  });

  it('断る枝は、来た順ではなく項目の順で先に当たったものを返す (名前が先)', () => {
    const r = buildRoomUpdate({ push_machine_posts: 'yes', name: '' }, roomAdmin);
    expect(r).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('グループ名') });
  });

  // ★ 今の動き: 確かめずに通す項目 (改善ループ 109 の報告で別に挙げた)
  it('message_edit_policy などは値を確かめずに通す (今の動き)', () => {
    expect(buildRoomUpdate({ message_edit_policy: 'unknown', voice_conversation_enabled: 'x', allow_member_transcription_edit: 1 }, roomAdmin))
      .toEqual({ ok: true, sets: [['allow_member_transcription_edit', 1], ['message_edit_policy', 'unknown'], ['voice_conversation_enabled', 'x']] });
  });
});

describe('isValidRoomName', () => {
  it.each([['A', true], ['', false], ['  ', false], [1, false], ['あ'.repeat(ROOM_NAME_MAX), true]])('%p → %p', (v, ok) => {
    expect(isValidRoomName(v)).toBe(ok);
  });
});

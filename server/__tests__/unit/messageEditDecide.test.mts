/**
 * 改善ループ 109: メッセージを直せるかの判定 (PUT /api/rooms/:id/messages/:msgId)。
 * 道の中に埋もれていて、none / sender の他人 / 削除済み / system・stamp の枝にテストが無かった。
 * 画面 (useContextMenuItems・voiceNav) は同じ規則の写しを持つので、本体がずれるとメニューは出るのに 403 になる。
 */
import { decideMessageEdit } from '../../src/services/messageEditDecide.mts';

const base = { isDeleted: false, type: 'text', hasContent: true, isOwn: true, policy: 'sender' };

describe('decideMessageEdit', () => {
  it('削除済みは 400 (ほかの条件より先)', () => {
    expect(decideMessageEdit({ ...base, isDeleted: true, policy: 'none' }))
      .toEqual({ ok: false, status: 400, error: '削除済みメッセージは編集できません' });
  });

  it.each(['system', 'stamp'])('%s は 400', (type) => {
    expect(decideMessageEdit({ ...base, type }))
      .toEqual({ ok: false, status: 400, error: 'このメッセージは編集できません' });
  });

  it('none は 403', () => {
    expect(decideMessageEdit({ ...base, policy: 'none' }))
      .toEqual({ ok: false, status: 403, error: 'このルームではメッセージ編集が許可されていません' });
  });

  it('sender で自分の便は通る (メンバーの確認は要らない)', () => {
    expect(decideMessageEdit(base)).toEqual({ ok: true, needsMemberCheck: false });
  });

  it('sender で他人の便は 403', () => {
    expect(decideMessageEdit({ ...base, isOwn: false }))
      .toEqual({ ok: false, status: 403, error: '送信者のみ編集できます' });
  });

  it('member は通るが、呼び出し側でメンバーかを確かめる', () => {
    expect(decideMessageEdit({ ...base, isOwn: false, policy: 'member' }))
      .toEqual({ ok: true, needsMemberCheck: true });
  });

  it('自分の本文の無い便への最初の説明文は、none でも通る', () => {
    expect(decideMessageEdit({ ...base, hasContent: false, policy: 'none' }))
      .toEqual({ ok: true, needsMemberCheck: false });
  });

  it('他人の本文の無い便は最初の説明文として扱わない (sender なら 403)', () => {
    expect(decideMessageEdit({ ...base, hasContent: false, isOwn: false }))
      .toEqual({ ok: false, status: 403, error: '送信者のみ編集できます' });
  });

  it('最初の説明文でも、削除済みは 400', () => {
    expect(decideMessageEdit({ ...base, hasContent: false, isDeleted: true }).ok).toBe(false);
  });

  // ★ 今の動きをそのまま写している (知らない値はどの枝にも当たらず通る)。画面は出さない。改善ループ 109 の報告で別に挙げた
  it('知らない policy は通る (今の動き)', () => {
    expect(decideMessageEdit({ ...base, isOwn: false, policy: 'unknown' }))
      .toEqual({ ok: true, needsMemberCheck: false });
  });
});

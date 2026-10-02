/**
 * system メッセージを LINE のように中央に小さく出す (2026-10-02、利用者の提案)
 *
 * ★ それまでは普通の吹き出しで、送り手のアイコン・名前つきで出ていた。
 *   「小野哲がアシスタントを追加しました」を送り手がボットの吹き出しで出すなど、誰の発言かが紛らわしかった
 * ★ 出すのは本文と時刻だけ。アイコン・名前・既読・吹き出しは出さない
 * ★ 偽装 (人やボットの口から system を名乗る) はサーバで止めてある (services/messageTypes.mts)。
 *   見た目を「公式の記録」らしくするのは、その後でないと偽物が本物らしく見える
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SystemMessage from '../../src/components/chat/SystemMessage';
import type { Message } from '../../src/types';

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1', room_id: 'r1', sender_id: 'u1', content: '📞 小野哲 が通話を開始しました', type: 'system',
  reply_to: null, is_deleted: false, created_at: '2026-10-02T05:14:51.084Z', updated_at: '2026-10-02T05:14:51.084Z',
  sender_display_name: '小野哲', sender_avatar_url: null, ...over,
} as Message);

describe('SystemMessage', () => {
  it('本文を中央の小さな行として出す (note として読める)', () => {
    render(<SystemMessage message={msg()} />);
    const note = screen.getByRole('note');
    expect(note).toHaveClass('system-message');
    expect(note).toHaveTextContent('📞 小野哲 が通話を開始しました');
  });
  it('時刻を添える', () => {
    render(<SystemMessage message={msg()} />);
    expect(screen.getByRole('note').textContent).toMatch(/\d{1,2}:\d{2}/);
  });
  it('★ 送り手の名前・アイコン・吹き出しは出さない', () => {
    const { container } = render(<SystemMessage message={msg({ sender_display_name: '送り手の名前' })} />);
    expect(container.textContent).not.toContain('送り手の名前');
    expect(container.querySelector('.bubble, .bubble-avatar, .bubble-avatar-placeholder, .bubble-sender-name')).toBeNull();
  });
});

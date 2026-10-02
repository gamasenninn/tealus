/**
 * MessageBubble は system メッセージを SystemMessage (中央に小さく) で出す (2026-10-02)
 * ★ SystemMessage 単体は SystemMessage.test.tsx。ここは「吹き出しの部品が system を振り分けるか」だけを見る
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/api', () => ({ api: { request: vi.fn(), get: vi.fn() } }));

import MessageBubble from '../../src/components/chat/MessageBubble';
import type { Message } from '../../src/types';

const base = {
  id: 'm1', room_id: 'R1', sender_id: 'u1', reply_to: null, is_deleted: false,
  created_at: '2026-10-02T05:14:51.084Z', updated_at: '2026-10-02T05:14:51.084Z',
  sender_display_name: '送り手の名前', sender_avatar_url: null,
};

const renderBubble = (message: Partial<Message>) => render(
  <MemoryRouter initialEntries={['/rooms/R1']}>
    <Routes><Route path="/rooms/:roomId" element={<MessageBubble message={{ ...base, ...message } as Message} isOwn={false} />} /></Routes>
  </MemoryRouter>,
);

describe('MessageBubble の system メッセージ', () => {
  it('★ system は中央の小さな行で出し、吹き出し・送り手の名前は出さない', () => {
    const { container } = renderBubble({ type: 'system', content: '📞 通話が終了しました' });
    expect(screen.getByRole('note')).toHaveTextContent('📞 通話が終了しました');
    expect(container.querySelector('.bubble, .bubble-sender-name')).toBeNull();
    expect(container.textContent).not.toContain('送り手の名前');
  });
  it('text は今までどおり吹き出しで、送り手の名前つき', () => {
    const { container } = renderBubble({ type: 'text', content: 'こんにちは' });
    expect(screen.queryByRole('note')).toBeNull();
    expect(container.querySelector('.bubble')).not.toBeNull();
    expect(container.textContent).toContain('送り手の名前');
  });
  it('削除済みの system は「削除されました」のまま', () => {
    renderBubble({ type: 'system', content: 'x', is_deleted: true });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText('メッセージが削除されました')).toBeInTheDocument();
  });
});

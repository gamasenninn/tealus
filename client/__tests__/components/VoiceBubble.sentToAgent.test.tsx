import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Message } from '../../src/types';

/**
 * 2026-10-24 小野さん判断: 「エージェントに送る」で送った音声は、文字起こしを 1 行に畳む
 * (送った文字の便と同じ文が 2 回並ぶ違和感を消す)。再生ボタンは残し、押せば広がる
 */
vi.mock('../../src/services/api', () => ({ api: {} }));
vi.mock('../../src/stores/confirmStore', () => ({ useConfirm: () => vi.fn(), notify: vi.fn() }));

import VoiceBubble from '../../src/components/chat/VoiceBubble';

const message = { id: 'm1', room_id: 'r1', type: 'voice', content: '' } as unknown as Message;

function renderWith(sentToAgent: boolean) {
  return render(
    <VoiceBubble
      message={message}
      media={[{ id: 'a1', file_path: '/media/a.webm' } as never]}
      transcription={{ status: 'done', raw_text: null, formatted_text: 'ポータルを調べて', version: 1 }}
      isOwn
      sentToAgent={sentToAgent}
    />,
  );
}

describe('エージェントに送った音声の畳み込み', () => {
  it('★ 送った音声は文字起こしを出さず、1 行の印だけ。押すと広がる', () => {
    renderWith(true);
    expect(screen.queryByText('ポータルを調べて')).toBeNull();
    fireEvent.click(screen.getByText(/エージェントに送った文字起こし/));
    expect(screen.getByText('ポータルを調べて')).toBeTruthy();
  });

  it('送っていない音声は今までどおり出す', () => {
    renderWith(false);
    expect(screen.getByText('ポータルを調べて')).toBeTruthy();
    expect(screen.queryByText(/エージェントに送った文字起こし/)).toBeNull();
  });
});

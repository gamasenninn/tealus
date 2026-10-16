import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '../../src/types';

/**
 * 宛名の候補 (2026-10-16 利用者判断「1 は a で」)。
 *
 * ★ 無線の手直しの 6 割強は冒頭の宛名だった (7 日で 336 便中 123 便)。宛名は現場の呼び名で、
 *   候補はその部屋で人が直した版から本体が数える (GET /rooms/:id/voice-address-candidates)。
 * ★ 押すと冒頭の呼びかけを差し替える (無ければ先頭に足す)。**保存はしない** —— 確定 / 移動で保存される。
 */
const getCandidatesMock = vi.fn();
vi.mock('../../src/services/api', () => ({
  api: {
    editTranscription: vi.fn().mockResolvedValue({ transcription: { formatted_text: 'x', version: 2 } }),
    getVoiceAddressCandidates: (...a: unknown[]) => getCandidatesMock(...a),
  },
}));

const mockMessages = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('../../src/stores/messageStore', () => {
  const state = () => ({ messages: mockMessages.list, updateTranscription: vi.fn() });
  const useMessageStore = (sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state());
  (useMessageStore as { getState?: () => ReturnType<typeof state> }).getState = () => state();
  return { useMessageStore };
});
vi.mock('../../src/stores/roomStore', () => {
  const state = () => ({ currentRoom: { id: 'r1', allow_member_transcription_edit: true } });
  const useRoomStore = (sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state());
  return { useRoomStore };
});
vi.mock('../../src/stores/authStore', () => {
  const state = () => ({ user: { id: 'u1' } });
  const useAuthStore = (sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state());
  return { useAuthStore };
});

import VoiceEditModal from '../../src/components/chat/VoiceEditModal';

const voice = (id: string, text: string): Message => ({
  id, room_id: 'r1', sender_id: 'u1', type: 'voice', content: null,
  created_at: '2026-10-16T00:00:00Z', is_deleted: false,
  media: [{ id: `${id}-m`, file_path: `p/${id}.m4a`, mime_type: 'audio/mp4' }],
  transcription: { status: 'done', formatted_text: text, version: 1 },
} as unknown as Message);

describe('VoiceEditModal — 宛名の候補', () => {
  beforeEach(() => {
    getCandidatesMock.mockReset();
    mockMessages.list = [voice('a', '佐藤さん、取れます？'), voice('b', 'はい、どうぞ')];
  });

  it('部屋の候補を並べ、押すと冒頭の呼びかけを差し替える', async () => {
    getCandidatesMock.mockResolvedValue({ candidates: [{ text: '斎藤さん', count: 5 }, { text: 'ガマさん', count: 3 }] });
    render(<VoiceEditModal messageId="a" onClose={vi.fn()} />);

    const btn = await screen.findByRole('button', { name: '斎藤さん' });
    expect(getCandidatesMock).toHaveBeenCalledWith('r1');
    fireEvent.click(btn);
    expect(screen.getByRole('textbox')).toHaveValue('斎藤さん、取れます？');
  });

  it('冒頭に呼びかけが無ければ先頭に足す', async () => {
    getCandidatesMock.mockResolvedValue({ candidates: [{ text: 'ガマさん', count: 3 }] });
    render(<VoiceEditModal messageId="b" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'ガマさん' }));
    expect(screen.getByRole('textbox')).toHaveValue('ガマさん、はい、どうぞ');
  });

  it('★ 押しただけでは保存しない (確定 / 移動で保存)', async () => {
    getCandidatesMock.mockResolvedValue({ candidates: [{ text: '斎藤さん', count: 5 }] });
    const { api } = await import('../../src/services/api');
    render(<VoiceEditModal messageId="a" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '斎藤さん' }));
    expect(api.editTranscription).not.toHaveBeenCalled();
    expect(screen.getByText('確定')).not.toBeDisabled();
  });

  it('候補が無ければ何も出さない', async () => {
    getCandidatesMock.mockResolvedValue({ candidates: [] });
    render(<VoiceEditModal messageId="a" onClose={vi.fn()} />);
    await waitFor(() => expect(getCandidatesMock).toHaveBeenCalled());
    expect(screen.queryByText('宛名')).toBeNull();
  });

  it('★ 候補の取得に失敗しても編集はできる', async () => {
    getCandidatesMock.mockRejectedValue(new Error('network'));
    render(<VoiceEditModal messageId="a" onClose={vi.fn()} />);
    await waitFor(() => expect(getCandidatesMock).toHaveBeenCalled());
    expect(screen.getByRole('textbox')).toHaveValue('佐藤さん、取れます？');
    expect(screen.queryByText('宛名')).toBeNull();
  });

  it('★ 通話履歴など注入された経路 (#379) では出さない (宛名は音声メッセージの版から数えているため)', async () => {
    getCandidatesMock.mockResolvedValue({ candidates: [{ text: '斎藤さん', count: 5 }] });
    render(
      <VoiceEditModal
        messageId="a"
        onClose={vi.fn()}
        selectItems={(msgs) => msgs as Message[]}
        textOf={(m) => m?.transcription?.formatted_text ?? ''}
        save={vi.fn()}
      />
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(getCandidatesMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '斎藤さん' })).toBeNull();
  });
});

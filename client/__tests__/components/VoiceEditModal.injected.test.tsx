import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '../../src/types';

/**
 * #379: 添付音声つきメッセージ側から、同じ連続編集モーダルを使う経路。
 *
 * ★ 注入するのは 一覧 / 本文 / 保存 / 再生バー の 4 つだけ。ここで固定するのは
 *   **注入した側の振る舞い**で、省略時 (音声メッセージ) の挙動は
 *   `VoiceEditModal.test.tsx` の特性テストが担当する。
 */
const editTranscriptionMock = vi.fn();
vi.mock('../../src/services/api', () => ({
  api: { editTranscription: (...a: unknown[]) => editTranscriptionMock(...a) },
}));
vi.mock('../../src/stores/messageStore', () => {
  const state = () => ({ messages: mockMessages.list, updateTranscription: vi.fn() });
  const useMessageStore = (sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state());
  (useMessageStore as { getState?: () => ReturnType<typeof state> }).getState = () => state();
  return { useMessageStore };
});
vi.mock('../../src/stores/roomStore', () => {
  const state = () => ({ currentRoom: { id: 'r1', message_edit_policy: 'member' } });
  const useRoomStore = (sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state());
  return { useRoomStore };
});
vi.mock('../../src/stores/authStore', () => {
  const state = () => ({ user: { id: 'u1' } });
  const useAuthStore = (sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state());
  return { useAuthStore };
});

const mockMessages = vi.hoisted(() => ({ list: [] as unknown[] }));

import VoiceEditModal from '../../src/components/chat/VoiceEditModal';
import MediaAudio from '../../src/components/media/MediaAudio';
import { editableAudioAttachmentMessages } from '../../src/utils/voiceNav';

const withAudio = (id: string, content: string): Message => ({
  id, room_id: 'r1', sender_id: 'bot', type: 'text', content, is_deleted: false,
  created_at: '2026-08-20T00:00:00Z',
  media: [{ id: `${id}-m`, file_path: `calls/${id}.m4a`, mime_type: 'audio/mp4' }],
} as unknown as Message);

function renderInjected(messageId: string, save: (id: string, text: string) => Promise<void>) {
  return render(
    <VoiceEditModal
      messageId={messageId}
      title="メッセージを編集"
      selectItems={(msgs, uid, room) => editableAudioAttachmentMessages(msgs, uid, room?.message_edit_policy)}
      textOf={(m) => m?.content || ''}
      save={save}
      renderPlayer={(m) => {
        const a = (m.media || []).find((x) => x.mime_type?.startsWith('audio/'));
        return a ? <MediaAudio key={a.id} media={a} /> : null;
      }}
      onClose={vi.fn()}
    />,
  );
}

describe('VoiceEditModal — 添付音声からの連続編集 (#379)', () => {
  beforeEach(() => {
    editTranscriptionMock.mockClear();
    mockMessages.list = [withAudio('a', 'AAA'), withAudio('b', 'BBB'), withAudio('c', 'CCC')];
  });

  it('★ 本文は message.content から取る (文字起こしではない)', () => {
    renderInjected('b', vi.fn().mockResolvedValue(undefined));
    expect(screen.getByRole('textbox')).toHaveValue('BBB');
    expect(screen.getByText('メッセージを編集')).toBeInTheDocument();
  });

  it('★ 前/次 で音声添付メッセージの間を移動する', async () => {
    renderInjected('b', vi.fn().mockResolvedValue(undefined));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    fireEvent.click(screen.getByText('次 →'));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('CCC'));
  });

  it('★ 注入した保存が呼ばれる (文字起こしの保存は呼ばれない)', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderInjected('b', save);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '直した' } });
    fireEvent.click(screen.getByText('次 →'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('b', '直した'));
    expect(editTranscriptionMock).not.toHaveBeenCalled();
  });

  /**
   * ★★★ サーバは内容が同じでも版を積み `is_edited` を立てる (同値スキップ無し)。
   * 通話履歴の読み手は `is_edited` を「人手訂正が確定した」の合図に使っているため、
   * 無変更保存は **確定していないものを確定に見せる**。
   */
  it('★★★ 無変更では保存しない (is_edited を偽装しない)', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderInjected('b', save);
    fireEvent.click(screen.getByText('次 →'));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('CCC'));
    expect(save).not.toHaveBeenCalled();
  });

  it('★ 保存に失敗したら移動しない (編集を黙って捨てない)', async () => {
    const save = vi.fn().mockRejectedValue(new Error('403'));
    renderInjected('b', save);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '直した' } });
    fireEvent.click(screen.getByText('次 →'));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(screen.getByRole('textbox')).toHaveValue('直した');      // 対象は変わらない
    expect(screen.getByText(/保存できませんでした/)).toBeInTheDocument();
  });

  it('★ 再生バーは注入されたもの (標準の audio controls) が出る', () => {
    const { container } = renderInjected('b', vi.fn().mockResolvedValue(undefined));
    const el = container.querySelector('audio');
    expect(el).toHaveAttribute('controls');
    expect(el).toHaveAttribute('src', '/media/calls/b.m4a');
  });
});

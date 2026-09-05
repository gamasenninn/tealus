import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '../../src/types';

/**
 * #379 Step 0: **現状の振る舞いを固定する特性テスト**。
 *
 * ★ `VoiceEditModal` は毎日使われる経路なのに部品テストが無く、注入点を開ける
 *   (voice / 添付音声 の両方から使えるようにする) 前に安全網が要る。ここで固定するのは
 *   **今の挙動そのもの**で、新機能ではない。以降の一般化でこれが赤くなったら退行。
 *
 * ★★ とくに「直していなければ保存しない」は、下流に効く:
 *   サーバは同値でも版を積み `is_edited` を立てるため、無変更保存は
 *   **「人手訂正が確定した」の合図を偽装する** (#379 の ② 参照)。
 */
const editTranscriptionMock = vi.fn().mockResolvedValue({
  transcription: { formatted_text: 'saved', version: 2 },
});
vi.mock('../../src/services/api', () => ({
  api: { editTranscription: (...a: unknown[]) => editTranscriptionMock(...a) },
}));

const updateTranscriptionMock = vi.fn();
const mockMessages = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('../../src/stores/messageStore', () => {
  const state = () => ({ messages: mockMessages.list, updateTranscription: updateTranscriptionMock });
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
  id,
  room_id: 'r1',
  sender_id: 'u1',
  type: 'voice',
  content: null,
  created_at: '2026-08-20T00:00:00Z',
  is_deleted: false,
  media: [{ id: `${id}-m`, file_path: `p/${id}.m4a`, mime_type: 'audio/mp4' }],
  transcription: { status: 'done', formatted_text: text, version: 1 },
} as unknown as Message);

describe('VoiceEditModal — 現状の振る舞い (#379 Step 0 特性テスト)', () => {
  beforeEach(() => {
    editTranscriptionMock.mockClear();
    updateTranscriptionMock.mockClear();
    mockMessages.list = [voice('a', 'AAA'), voice('b', 'BBB'), voice('c', 'CCC')];
  });

  it('開いた対象の文字起こしが入力欄に入る', () => {
    render(<VoiceEditModal messageId="b" onClose={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('BBB');
  });

  it('★ 次 → で隣の対象に切り替わる', async () => {
    render(<VoiceEditModal messageId="b" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('次 →'));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('CCC'));
  });

  it('★ ← 前 で 1 つ戻る', async () => {
    render(<VoiceEditModal messageId="b" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('← 前'));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('AAA'));
  });

  it('端では 前/次 が押せない', () => {
    render(<VoiceEditModal messageId="a" onClose={vi.fn()} />);
    expect(screen.getByText('← 前')).toBeDisabled();
    expect(screen.getByText('次 →')).not.toBeDisabled();
  });

  it('★ 直していれば、移動する前に保存する', async () => {
    render(<VoiceEditModal messageId="b" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '直した' } });
    fireEvent.click(screen.getByText('次 →'));
    await waitFor(() => expect(editTranscriptionMock).toHaveBeenCalledWith('b', '直した'));
  });

  it('★★★ 直していなければ保存しない (無変更で版を増やさない)', async () => {
    render(<VoiceEditModal messageId="b" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('次 →'));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('CCC'));
    expect(editTranscriptionMock).not.toHaveBeenCalled();
  });

  it('★ 戻る では、直していれば保存してから閉じる', async () => {
    const onClose = vi.fn();
    render(<VoiceEditModal messageId="b" onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '直した' } });
    fireEvent.click(screen.getByText('戻る'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(editTranscriptionMock).toHaveBeenCalledWith('b', '直した');
  });

  it('戻る は、直していなければ保存せずに閉じる', async () => {
    const onClose = vi.fn();
    render(<VoiceEditModal messageId="b" onClose={onClose} />);
    fireEvent.click(screen.getByText('戻る'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(editTranscriptionMock).not.toHaveBeenCalled();
  });

  it('確定 は 直していないと押せない', () => {
    render(<VoiceEditModal messageId="b" onClose={vi.fn()} />);
    expect(screen.getByText('確定')).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    expect(screen.getByText('確定')).not.toBeDisabled();
  });
});

/**
 * 開いた直後 / 移動した直後のフォーカス (2026-09-05)。
 *
 * ★ textarea の autoFocus をやめる。スマホで編集を開くと仮想キーボードが自動で立ち上がり、
 *   textarea の**上**にある音声プレイヤーと時刻シークバーが画面から押し出されていた。
 *
 * ★★ **前/次 で移動した後も当てない。** ここは「連続編集が止まる」ので当てる案もあったが、
 *   user 判断は「広いエリアで内容を確認して、修正が必要ならタップする」。
 *   つまり移動直後は**読む場面**であって、打つ場面ではない。
 *   textarea には `key={currentId}` が付いていて移動のたびに作り直されるので、
 *   autoFocus を残すと移動のたびにキーボードが出る。
 *
 * ★ 当てないのではなく modal-box に移す (Tab が裏のトーク画面へ抜けないように)。
 */
describe('VoiceEditModal — フォーカス (勝手にキーボードを出さない)', () => {
  beforeEach(() => {
    editTranscriptionMock.mockClear();
    updateTranscriptionMock.mockClear();
    mockMessages.list = [voice('a', 'AAA'), voice('b', 'BBB'), voice('c', 'CCC')];
  });

  it('★ 開いた直後、textarea にフォーカスを当てない', () => {
    const { container } = render(<VoiceEditModal messageId="b" onClose={vi.fn()} />);
    const textarea = container.querySelector('textarea')!;
    expect(textarea).not.toHaveAttribute('autofocus');
    expect(document.activeElement).not.toBe(textarea);
  });

  it('★ 代わりに modal-box にフォーカスが移る', () => {
    const { container } = render(<VoiceEditModal messageId="b" onClose={vi.fn()} />);
    expect(document.activeElement).toBe(container.querySelector('.modal-box'));
  });

  it('★★ 次 → で移動した後も当てない (読んでから、必要ならタップする)', async () => {
    const { container } = render(<VoiceEditModal messageId="b" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('次 →'));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('CCC'));
    expect(document.activeElement).not.toBe(container.querySelector('textarea'));
  });
});

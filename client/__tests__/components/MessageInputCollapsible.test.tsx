/**
 * #513 マルチトークのパネルでは入力欄を畳み、押したら大きく広げる
 *
 * パネル (幅 318px) では 4 つのボタンに挟まれて入力欄が 118px しか無かった。
 * パネルの中から書く機会は少ないので、普段は 1 行の帯 + マイクだけにし、押したら重ねて広げる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const sendRoomMessage = vi.fn();
vi.mock('../../src/services/sendRoomMessage', () => ({ sendRoomMessage: (a: unknown) => sendRoomMessage(a) }));
vi.mock('../../src/services/api', () => ({ api: {
  getCcProjects: vi.fn().mockResolvedValue({ projects: [] }),
  getPromptHistory: vi.fn().mockResolvedValue({ items: [], target_counts: {} }),
  getMessages: vi.fn().mockResolvedValue({ messages: [] }),
  request: vi.fn().mockResolvedValue({}),
} }));
vi.mock('../../src/services/socket', () => ({ getSocket: () => ({ emit: vi.fn() }) }));
vi.mock('../../src/stores/agentStore', () => ({
  useAgentStore: () => ({ assistantUserId: null, assistantName: null, fetchIdentity: vi.fn() }),
}));
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u1', role: 'user' } }) }));

import MessageInput from '../../src/components/chat/MessageInput';
import { useMessageStore } from '../../src/stores/messageStore';

const textarea = () => document.querySelector('textarea.message-input-text') as HTMLTextAreaElement | null;
const bar = () => screen.getByRole('button', { name: /メッセージを入力|下書き/ });

describe('MessageInput — 畳める入力欄 (#513)', () => {
  beforeEach(() => {
    sendRoomMessage.mockReset().mockResolvedValue(undefined);
    useMessageStore.setState({ replyTo: null, pendingAgentMessage: null } as never);
  });

  it('畳める設定が無ければ、今までどおり入力欄が出ている', () => {
    render(<MessageInput roomId="r1" />);
    expect(textarea()).not.toBeNull();
    expect(screen.queryByRole('button', { name: /メッセージを入力/ })).toBeNull();
  });

  it('★ 畳める設定なら、最初は帯とマイクだけ (入力欄は出さない)', () => {
    render(<MessageInput roomId="r1" collapsible />);
    expect(textarea()).toBeNull();
    expect(bar()).toBeTruthy();
    expect(document.querySelector('.message-input-mic-main')).not.toBeNull();
  });

  it('★ 帯を押すと広げて、入力欄にカーソルを置く', async () => {
    render(<MessageInput roomId="r1" collapsible />);
    fireEvent.click(bar());
    expect(textarea()).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(textarea()));
  });

  it('★★ 書きかけで畳んでも消えない。帯に「下書き」と出て、広げ直すと残っている', () => {
    render(<MessageInput roomId="r1" collapsible />);
    fireEvent.click(bar());
    fireEvent.change(textarea()!, { target: { value: 'こんにちは', selectionStart: 5 } });
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(textarea()).toBeNull();
    expect(bar().textContent).toContain('下書き');
    expect(bar().textContent).toContain('こんにちは');
    fireEvent.click(bar());
    expect(textarea()!.value).toBe('こんにちは');
  });

  it('Esc で畳む', () => {
    render(<MessageInput roomId="r1" collapsible />);
    fireEvent.click(bar());
    fireEvent.keyDown(textarea()!, { key: 'Escape' });
    expect(textarea()).toBeNull();
  });

  it('★ 送ったら畳む', async () => {
    render(<MessageInput roomId="r1" collapsible />);
    fireEvent.click(bar());
    fireEvent.change(textarea()!, { target: { value: '送ります', selectionStart: 4 } });
    await act(async () => { fireEvent.click(document.querySelector('.message-input-send')!); });
    expect(sendRoomMessage).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'r1', content: '送ります' }));
    expect(textarea()).toBeNull();
    expect(bar().textContent).not.toContain('下書き');
  });

  it('★★ 返信先が付いたら自動で広げる (返信・「エージェントに送る」はどちらも返信先を付ける)', async () => {
    render(<MessageInput roomId="r1" collapsible />);
    expect(textarea()).toBeNull();
    act(() => { useMessageStore.getState().setReplyTo({ id: 'm1', sender_display_name: 'A', content: 'x' } as never); });
    await waitFor(() => expect(textarea()).not.toBeNull());
  });
});

/**
 * ★ #537 送れなかったら (つながっていない)、入力欄の文を残して理由を出す。以前は何も出なかった
 */
describe('MessageInput — 送れなかったとき (#537)', () => {
  beforeEach(() => {
    sendRoomMessage.mockReset();
    useMessageStore.setState({ replyTo: null, pendingAgentMessage: null } as never);
  });

  it('★★ 文は入力欄に残り、理由が出る', async () => {
    sendRoomMessage.mockRejectedValue(new Error('つながっていないため送れませんでした。電波を確かめて、もう一度送ってください'));
    render(<MessageInput roomId="r1" />);
    fireEvent.change(textarea()!, { target: { value: '大事な返事' } });
    await act(async () => { fireEvent.keyDown(textarea()!, { key: 'Enter', ctrlKey: true }); });
    await waitFor(() => expect(document.querySelector('.message-input-error')?.textContent).toMatch(/つながっていない/));
    expect(textarea()!.value).toBe('大事な返事');
  });
});

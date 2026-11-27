/**
 * #619 音声・写真の送信に失敗したとき、録音や写真を手元に残して「もう一度送る」を出す
 * ★ 以前は失敗が画面に出るだけで、録音・選んだ写真は消えた (録り直し・選び直し)
 * ★ 送れていたのに返事だけ来なかったときに二重に送らない: もう一度送る前に部屋を読み直す
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getCcProjects: vi.fn().mockResolvedValue({ projects: [] }),
  getPromptHistory: vi.fn().mockResolvedValue({ items: [], target_counts: {} }),
  getMessages: vi.fn(),
  request: vi.fn().mockResolvedValue({}),
  uploadVoice: vi.fn(),
  uploadMedia: vi.fn(),
}));
vi.mock('../../src/services/api', () => ({ api }));
vi.mock('../../src/services/sendRoomMessage', () => ({ sendRoomMessage: vi.fn() }));
vi.mock('../../src/components/chat/VoiceRecorder', () => ({
  default: ({ onSend }: { onSend: (b: Blob, t: string) => void }) => (
    <button data-testid="voice-send-stub" onClick={() => onSend(new Blob(['録音']), 'audio/webm')}>送信</button>
  ),
}));
vi.mock('../../src/services/socket', () => ({ getSocket: () => ({ emit: vi.fn() }) }));
vi.mock('../../src/stores/agentStore', () => ({
  useAgentStore: () => ({ assistantUserId: null, assistantName: null, fetchIdentity: vi.fn() }),
}));
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'me', role: 'user' } }) }));

import MessageInput from '../../src/components/chat/MessageInput';
import { useMessageStore } from '../../src/stores/messageStore';

const msg = (id: string, sender_id: string, type: string) => ({ id, room_id: 'r1', sender_id, type, content: '', created_at: '2026-11-27T00:00:00Z' });
const BEFORE = [msg('a', 'u2', 'text')];

async function recordAndSend() {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getAudioTracks: () => [], getTracks: () => [] }) },
    configurable: true,
  });
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '音声で送る' })[0]); });
  await act(async () => { fireEvent.click(await screen.findByTestId('voice-send-stub')); });
}

describe('MessageInput — 送れなかった音声・写真をもう一度送る (#619)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    api.uploadVoice.mockReset(); api.uploadMedia.mockReset();
    api.getMessages.mockReset().mockResolvedValue({ messages: BEFORE, has_more: false });
    useMessageStore.setState({ roomId: 'r1', messages: BEFORE, replyTo: null, pendingAgentMessage: null } as never);
  });

  it('★★ 音声の送信に失敗したら、理由と「もう一度送る」「やめる」を出す (録音は残っている)', async () => {
    api.uploadVoice.mockRejectedValueOnce(new Error('ネットワークに接続できません'));
    render(<MessageInput roomId="r1" />);
    await recordAndSend();
    expect(await screen.findByRole('button', { name: 'もう一度送る' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'やめる' })).toBeTruthy();
    expect(screen.getByText(/ネットワークに接続できません/)).toBeTruthy();
    expect(screen.getByText(/音声/)).toBeTruthy();
  });

  it('★★ 「もう一度送る」で、同じ録音をもう一度送る。送れたら消える', async () => {
    api.uploadVoice.mockRejectedValueOnce(new Error('切れました')).mockResolvedValueOnce({});
    render(<MessageInput roomId="r1" />);
    await recordAndSend();
    const first = api.uploadVoice.mock.calls[0][1] as Blob;
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'もう一度送る' })); });
    await waitFor(() => expect(api.uploadVoice).toHaveBeenCalledTimes(2));
    expect(api.uploadVoice.mock.calls[1][1]).toBe(first);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'もう一度送る' })).toBeNull());
  });

  it('★★★ 実は届いていた (読み直すと自分の音声が増えている) なら、もう一度は送らず「送れていました」', async () => {
    api.uploadVoice.mockRejectedValueOnce(new Error('切れました'));
    render(<MessageInput roomId="r1" />);
    await recordAndSend();
    // ★ 本体は新しい順で返す (店が古い順に並べ直す)
    api.getMessages.mockResolvedValue({ messages: [msg('v1', 'me', 'voice'), ...BEFORE], has_more: false });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'もう一度送る' })); });
    await waitFor(() => expect(screen.getByText(/送れていました/)).toBeTruthy());
    expect(api.uploadVoice).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'もう一度送る' })).toBeNull();
  });

  it('★ 「やめる」で手元の録音を捨てる (送らない)', async () => {
    api.uploadVoice.mockRejectedValueOnce(new Error('切れました'));
    render(<MessageInput roomId="r1" />);
    await recordAndSend();
    fireEvent.click(await screen.findByRole('button', { name: 'やめる' }));
    expect(screen.queryByRole('button', { name: 'もう一度送る' })).toBeNull();
    expect(api.uploadVoice).toHaveBeenCalledTimes(1);
  });

  it('★ 返信の宛先も、もう一度送るときに同じものを付ける', async () => {
    api.uploadVoice.mockRejectedValueOnce(new Error('切れました')).mockResolvedValueOnce({});
    render(<MessageInput roomId="r1" />);
    act(() => { useMessageStore.getState().setReplyTo({ id: 'm9', sender_display_name: 'A', content: 'x' } as never); });
    await recordAndSend();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'もう一度送る' })); });
    await waitFor(() => expect(api.uploadVoice).toHaveBeenCalledTimes(2));
    expect(api.uploadVoice.mock.calls[0][3]).toBe('m9');
    expect(api.uploadVoice.mock.calls[1][3]).toBe('m9');
  });

  it('★★ 写真の送信に失敗しても同じ: 選んだ写真が残り、「もう一度送る」で同じ写真を送る', async () => {
    api.uploadMedia.mockRejectedValueOnce(new Error('切れました')).mockResolvedValueOnce({});
    const { container } = render(<MessageInput roomId="r1" />);
    const file = new File(['p'], 'photo.jpg', { type: 'image/jpeg' });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    expect(await screen.findByText(/写真・ファイル 1 件/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'もう一度送る' })); });
    await waitFor(() => expect(api.uploadMedia).toHaveBeenCalledTimes(2));
    expect(api.uploadMedia.mock.calls[1][1]).toEqual([file]);
  });
});

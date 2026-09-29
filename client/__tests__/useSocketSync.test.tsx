/**
 * useSocketSync: 再接続時に一過性の「考え中」/「入力中」表示をリセットする回帰テスト。
 *
 * バグ: スマホがスリープ→socket 切断中に agent の idle / typing:stop を取りこぼすと、
 * 復帰(再接続)後も agentStatus/typingUsers が残り続ける（議事録が完成しても「考え中」が消えない）。
 * 修正: socket 'connect'(再接続) で ephemeral 表示をリセットする。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// --- 依存 mock（hook のロジックだけを検証するため最小化） ---
const store = {
  addMessage: vi.fn(), fetchMessages: vi.fn(), clearMessages: vi.fn(),
  updateMessageContent: vi.fn(), updateReadCount: vi.fn(), updateTranscription: vi.fn(),
  updateReactions: vi.fn(), updateLinkPreview: vi.fn(), markDeleted: vi.fn(),
  updatePublishStatus: vi.fn(),
};
vi.mock('../src/stores/messageStore', () => {
  const useMessageStore = () => store;
  (useMessageStore as unknown as { getState: () => typeof store }).getState = () => store;
  return { useMessageStore };
});
vi.mock('../src/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u1' } }) }));
vi.mock('../src/stores/roomStore', () => ({ useRoomStore: () => ({ selectRoom: vi.fn(), clearCurrentRoom: vi.fn() }) }));
vi.mock('../src/services/api', () => ({ api: { markRead: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../src/services/browserTts', () => ({ speakAuto: vi.fn() }));
vi.mock('../src/services/ttsAudioPlayer', () => ({ playTtsSrc: vi.fn() }));

// 記録型の fake socket
type Handler = (data?: unknown) => void;
const fakeSocket = {
  handlers: {} as Record<string, Handler>,
  on(e: string, h: Handler) { this.handlers[e] = h; },
  off(e: string) { delete this.handlers[e]; },
  emit() { /* noop */ },
  trigger(e: string, data?: unknown) { this.handlers[e]?.(data); },
};
vi.mock('../src/services/socket', () => ({ getSocket: () => fakeSocket }));

import { useSocketSync } from '../src/hooks/useSocketSync';
import { playTtsSrc } from '../src/services/ttsAudioPlayer';
import { speakAuto } from '../src/services/browserTts';
import { holdAudio, releaseAudio } from '../src/utils/audioExclusive';
import { api } from '../src/services/api';

// #413 読み上げの取得は fetch で始まる。掴まれている間は**取りに行きもしない**ことを見る
globalThis.fetch = vi.fn(async () => ({
  ok: true, status: 200, blob: async () => new Blob(['x']),
})) as unknown as typeof fetch;
globalThis.URL.createObjectURL = vi.fn(() => 'blob:tts');
globalThis.URL.revokeObjectURL = vi.fn();

describe('useSocketSync 再接続リセット (#考え中残り bug)', () => {
  beforeEach(() => { fakeSocket.handlers = {}; });

  it('再接続(connect)で agentStatus(考え中) がリセットされる', () => {
    const { result } = renderHook(() => useSocketSync('room1'));

    act(() => fakeSocket.trigger('agent:status', { room_id: 'room1', agent_id: 'a1', status: 'processing' }));
    expect(result.current.agentStatus).not.toBeNull();

    // スリープ復帰＝socket 再接続。idle を取りこぼしていても、ここで消えるべき。
    act(() => fakeSocket.trigger('connect'));
    expect(result.current.agentStatus).toBeNull();
  });

  it('再接続(connect)で typingUsers(入力中) もリセットされる', () => {
    const { result } = renderHook(() => useSocketSync('room1'));

    act(() => fakeSocket.trigger('typing:start', { room_id: 'room1', user_id: 'other', display_name: '田中' }));
    expect(Object.keys(result.current.typingUsers)).toHaveLength(1);

    act(() => fakeSocket.trigger('connect'));
    expect(Object.keys(result.current.typingUsers)).toHaveLength(0);
  });
});

/**
 * #413 会話中に他ルームの読み上げが重なって鳴っていた。
 *
 * ★ 会話は「1 回の再生」ではなく「続いているセッション」なので、
 *   あとから来た読み上げに譲って会話が止まるのは逆。**自動の読み上げの方が始まらない**。
 * ★ 読み上げを飛ばしてもメッセージ自体はルームに残るので、失われるものは無い。
 */
describe('useSocketSync — 会話が音声を掴んでいる間の自動読み上げ (#413)', () => {
  beforeEach(() => {
    fakeSocket.handlers = {};
    localStorage.setItem('ttsReadAloud', 'on');
    vi.mocked(playTtsSrc).mockClear();
    vi.mocked(speakAuto).mockClear();
    vi.mocked(globalThis.fetch).mockClear();
    releaseAudio('voice-chat:s1');
  });

  it('★★ 掴まれている間は読み上げを始めない (音声ファイルの経路)', async () => {
    renderHook(() => useSocketSync('room1'));
    holdAudio('voice-chat:s1');

    await act(async () => {
      fakeSocket.trigger('tts:audio', { room_id: 'room1', sender_id: 'other', url: '/media/tts-1.mp3' });
    });

    expect(playTtsSrc).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();   // ★ 取りに行きもしない
  });

  it('★★ ブラウザの読み上げ (tts:speak) も始めない', async () => {
    renderHook(() => useSocketSync('room1'));
    holdAudio('voice-chat:s1');

    await act(async () => {
      fakeSocket.trigger('tts:speak', { room_id: 'room1', sender_id: 'other', text: 'お知らせです' });
    });

    expect(speakAuto).not.toHaveBeenCalled();
  });

  it('★ 離されたら、また読み上げる', async () => {
    renderHook(() => useSocketSync('room1'));
    holdAudio('voice-chat:s1');
    releaseAudio('voice-chat:s1');

    await act(async () => {
      fakeSocket.trigger('tts:audio', { room_id: 'room1', sender_id: 'other', url: '/media/tts-1.mp3' });
    });

    expect(playTtsSrc).toHaveBeenCalled();
  });
});

// #474 部屋を開いたままの端末が、画面が裏にある間も届いた投稿を既読にしていた
// (既読は人ごとに 1 つなので、他の端末に未読の数が出ない。トランシーバー履歴で報告)
describe('useSocketSync — 画面が見えているときだけ既読にする (#474)', () => {
  let visibility: DocumentVisibilityState = 'visible';
  const setVisibility = (v: DocumentVisibilityState) => {
    visibility = v;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const markRead = () => vi.mocked(api.markRead);
  const readEmits = () => vi.mocked(fakeSocket.emit).mock.calls.filter((c) => (c as unknown[])[0] === 'message:read');
  const newMessage = (id: string, sender = 'other') =>
    fakeSocket.trigger('message:new', { id, room_id: 'room1', sender_id: sender, type: 'text', content: 'x' });

  beforeEach(() => {
    fakeSocket.handlers = {};
    localStorage.setItem('ttsReadAloud', 'off');
    localStorage.setItem('notificationSound', 'off');   // jsdom は音を鳴らせない
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    visibility = 'visible';
    markRead().mockClear();
    markRead().mockResolvedValue(undefined as never);
    vi.spyOn(fakeSocket, 'emit').mockClear();
  });

  it('見えている間は、届いた投稿をその場で既読にする (今までどおり)', () => {
    renderHook(() => useSocketSync('room1'));
    act(() => newMessage('m1'));
    expect(markRead()).toHaveBeenCalledWith('room1', ['m1']);
    expect(readEmits()).toEqual([['message:read', { room_id: 'room1', message_ids: ['m1'] }]]);
  });

  it('★★ 裏にある間に届いた投稿は、既読にしない', () => {
    renderHook(() => useSocketSync('room1'));
    act(() => setVisibility('hidden'));
    act(() => { newMessage('m1'); newMessage('m2'); });
    expect(markRead()).not.toHaveBeenCalled();
    expect(readEmits()).toEqual([]);
  });

  it('★★ 画面に戻ったとき、裏にある間の分をまとめて 1 回で既読にする', () => {
    renderHook(() => useSocketSync('room1'));
    act(() => setVisibility('hidden'));
    act(() => { newMessage('m1'); newMessage('m2'); });
    act(() => setVisibility('visible'));
    expect(markRead()).toHaveBeenCalledTimes(1);
    expect(markRead()).toHaveBeenCalledWith('room1', ['m1', 'm2']);
    expect(readEmits()).toEqual([['message:read', { room_id: 'room1', message_ids: ['m1', 'm2'] }]]);
  });

  it('★ 戻ったあとにもう一度裏→表にしても、同じ分を二重に既読にしない', () => {
    renderHook(() => useSocketSync('room1'));
    act(() => setVisibility('hidden'));
    act(() => newMessage('m1'));
    act(() => setVisibility('visible'));
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(markRead()).toHaveBeenCalledTimes(1);
  });

  it('自分の投稿は、見えていても裏でも既読にしない', () => {
    renderHook(() => useSocketSync('room1'));
    act(() => newMessage('mine', 'u1'));
    act(() => setVisibility('hidden'));
    act(() => newMessage('mine2', 'u1'));
    act(() => setVisibility('visible'));
    expect(markRead()).not.toHaveBeenCalled();
  });

  it('部屋を離れたら、溜めていた分は既読にしない (別の部屋で戻っても送らない)', () => {
    const { unmount } = renderHook(() => useSocketSync('room1'));
    act(() => setVisibility('hidden'));
    act(() => newMessage('m1'));
    unmount();
    act(() => setVisibility('visible'));
    expect(markRead()).not.toHaveBeenCalled();
  });
});

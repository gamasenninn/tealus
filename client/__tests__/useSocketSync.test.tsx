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

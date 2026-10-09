// 着信に応答したら、サーバーに「参加した」(call:start) を送る (#524)
// ★ 2026-10-09 UI 試験で: 応答しても送っていなかった。2 人で話していても部屋の見出しは「待機中」、
//   サーバーは発信者 1 人の通話だと思い込み、残った着信の画面からの拒否で話している最中の通話を終えうる
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCallNotification } from '../../src/hooks/useCallNotification';

const handlers = new Map<string, (d: unknown) => void>();
const emit = vi.fn();
vi.mock('../../src/services/socket', () => ({
  getSocket: () => ({
    emit,
    on: (name: string, fn: (d: unknown) => void) => handlers.set(name, fn),
    off: (name: string) => handlers.delete(name),
  }),
}));
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u-b' }, token: 't' }) }));
vi.mock('../../src/stores/capabilityStore', () => ({
  useCapabilityStore: { getState: () => ({ realtimeVoiceAvailable: true }) },
}));
vi.mock('../../src/stores/confirmStore', () => ({ notify: vi.fn() }));

describe('useCallNotification — 応答', () => {
  beforeEach(() => { handlers.clear(); emit.mockClear(); });

  it('★ 応答したら call:start を送って通話に加わる', () => {
    const { result } = renderHook(() => useCallNotification());
    act(() => handlers.get('call:incoming')!({ roomId: 'r1', callerId: 'u-a', callerName: 'A' }));
    expect(result.current.incomingCall?.roomId).toBe('r1');

    act(() => result.current.acceptCall());

    // ★ #535 join: 続いている通話に入るだけ (発信者が切った後なら、本体は新しい通話を始めない)
    expect(emit).toHaveBeenCalledWith('call:start', { roomId: 'r1', join: true });
    expect(result.current.activeCall?.roomId).toBe('r1');
    expect(result.current.incomingCall).toBeNull();
  });

  it('拒否では call:start を送らない (call:reject だけ)', () => {
    const { result } = renderHook(() => useCallNotification());
    act(() => handlers.get('call:incoming')!({ roomId: 'r1', callerId: 'u-a', callerName: 'A' }));
    act(() => result.current.rejectCall());
    expect(emit).toHaveBeenCalledWith('call:reject', { roomId: 'r1', callerId: 'u-a' });
    expect(emit).not.toHaveBeenCalledWith('call:start', expect.anything());
  });
});

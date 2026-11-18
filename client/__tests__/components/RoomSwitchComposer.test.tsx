/**
 * 部屋を移ったら、入力欄の書きかけ・録音・送信中の状態を次の部屋へ持ち越さない (改善ループ 64、#649 A-2)
 *
 * ★ パソコンの 2 列の画面では、部屋を移ってもトーク画面 (ChatRoom) は作り直されない (App.tsx の Route に key が無い)。
 *   入力欄 (MessageInput) の state も残り、部屋 A の下書きが部屋 B の入力欄に出て、そのまま B へ送れた。
 *   録音中に移ると、新しい部屋へ音声が送られた。利用者の判断 (2026-11-18): 下書きは部屋ごとに残さず、消す
 * ★ 直し: ChatRoom が MessageInput に key={roomId} を付けて作り直す。作り直しで録音の部品が外れたとき、
 *   マイクを止める (止めないとマイク使用中の表示が残る)
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readSrc } from '../helpers/srcFiles';

vi.mock('../../src/services/audioContext', () => ({
  getSharedAudioContext: () => ({
    createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    createAnalyser: () => ({ fftSize: 0, frequencyBinCount: 4, getByteFrequencyData: vi.fn() }),
  }),
}));

import VoiceRecorder from '../../src/components/chat/VoiceRecorder';

describe('部屋を移ったときの入力欄', () => {
  it('★ ChatRoom は MessageInput を部屋ごとに作り直す (key={roomId})', () => {
    const src = readSrc('components/chat/ChatRoom.tsx');
    expect(src).toMatch(/<MessageInput\s+key=\{roomId\}/);
  });

  it('★ 録音の部品が外れたら (部屋を移って作り直されたら)、マイクを止める', () => {
    class FakeRecorder {
      static isTypeSupported() { return true; }
      state = 'recording';
      mimeType = 'audio/webm';
      ondataavailable: unknown = null;
      onstop: unknown = null;
      start() {}
      stop() { this.state = 'inactive'; }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }], getAudioTracks: () => [{ stop }] } as unknown as MediaStream;
    const { unmount } = render(<VoiceRecorder stream={stream} onSend={vi.fn()} onCancel={vi.fn()} />);
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

/**
 * 読み上げボタンの再タップで止めたとき、読み上げの後片付けを通す (2026-10-29 改善ループ 24 回目)
 * ★ 以前は自前の stop が pause するだけで、つないだ部品・blob URL・停止ボタン (isPlaying) が次の読み上げまで残った
 * ★ #664 「いま鳴っている音」はボタンの写しでなく、読み上げの側 (isCurrentTts) で見る
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

// 読み上げの側の「いま鳴っている音」を真似る: 最後に鳴らしたものが今のもの
let current: unknown = null;
const stopCurrentTts = vi.fn(() => { current = null; });
const playTtsSrc = vi.fn(() => { const a = { paused: false }; current = a; return a; });
vi.mock('../../src/services/ttsAudioPlayer', () => ({
  playTtsSrc: (...a: unknown[]) => playTtsSrc(...(a as [])),
  stopCurrentTts: () => stopCurrentTts(),
  isCurrentTts: (a: unknown) => a !== null && a === current,
}));
vi.mock('../../src/services/clientConfig', () => ({ getConfig: () => ({ tts_provider: 'aivis-cloud' }) }));
vi.mock('../../src/services/audioContext', () => ({ unlockAudio: vi.fn() }));
vi.mock('../../src/services/api', () => ({ api: { synthesizeTts: vi.fn(async () => new Blob(['x'])) } }));
vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });

const { default: TtsButton } = await import('../../src/components/chat/TtsButton');

describe('TtsButton の再タップ', () => {
  beforeEach(() => { current = null; stopCurrentTts.mockClear(); playTtsSrc.mockClear(); });

  it('★ 鳴っている自分の読み上げを、読み上げの側の stopCurrentTts で止める', async () => {
    const { getByTitle } = render(<TtsButton text="こんにちは" roomId="r1" />);
    fireEvent.click(getByTitle('読み上げ'));
    await waitFor(() => expect(playTtsSrc).toHaveBeenCalledTimes(1));
    stopCurrentTts.mockClear();
    fireEvent.click(getByTitle('読み上げ'));
    await waitFor(() => expect(stopCurrentTts).toHaveBeenCalledTimes(1));
    expect(playTtsSrc).toHaveBeenCalledTimes(1);   // 2 回目は鳴らし直さない
  });

  it('★ #664 別のボタンの読み上げに替わったあとで押し直すと、止めずに鳴らし直す (今鳴っているのは自分ではない)', async () => {
    const a = render(<TtsButton text="一つ目" roomId="r1" />);
    const b = render(<TtsButton text="二つ目" roomId="r1" />);
    fireEvent.click(a.getAllByTitle('読み上げ')[0]);
    await waitFor(() => expect(playTtsSrc).toHaveBeenCalledTimes(1));
    fireEvent.click(b.getAllByTitle('読み上げ')[1]);
    await waitFor(() => expect(playTtsSrc).toHaveBeenCalledTimes(2));
    fireEvent.click(a.getAllByTitle('読み上げ')[0]);
    await waitFor(() => expect(playTtsSrc).toHaveBeenCalledTimes(3));
    expect(stopCurrentTts).not.toHaveBeenCalled();
  });
});

/**
 * 読み上げボタンの再タップで止めたとき、読み上げの後片付けを通す (2026-10-29 改善ループ 24 回目)
 * ★ 以前は自前の stop が pause するだけで、つないだ部品・blob URL・停止ボタン (isPlaying) が次の読み上げまで残った
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const stopCurrentTts = vi.fn();
const playTtsSrc = vi.fn(() => ({ paused: false }));
vi.mock('../../src/services/ttsAudioPlayer', () => ({ playTtsSrc: (...a: unknown[]) => playTtsSrc(...(a as [])), stopCurrentTts: () => stopCurrentTts() }));
vi.mock('../../src/services/clientConfig', () => ({ getConfig: () => ({ tts_provider: 'aivis-cloud' }) }));
vi.mock('../../src/services/audioContext', () => ({ unlockAudio: vi.fn() }));
vi.mock('../../src/services/api', () => ({ api: { synthesizeTts: vi.fn(async () => new Blob(['x'])) } }));
vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });

const { default: TtsButton } = await import('../../src/components/chat/TtsButton');

describe('TtsButton の再タップ', () => {
  it('★ 鳴っている自分の読み上げを、読み上げの側の stopCurrentTts で止める', async () => {
    const { getByTitle } = render(<TtsButton text="こんにちは" roomId="r1" />);
    fireEvent.click(getByTitle('読み上げ'));
    await waitFor(() => expect(playTtsSrc).toHaveBeenCalledTimes(1));
    stopCurrentTts.mockClear();
    fireEvent.click(getByTitle('読み上げ'));
    await waitFor(() => expect(stopCurrentTts).toHaveBeenCalledTimes(1));
    expect(playTtsSrc).toHaveBeenCalledTimes(1);   // 2 回目は鳴らし直さない
  });
});

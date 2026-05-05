/**
 * TTS 再生状態 store (#243)
 *
 * AI 回答音声 (auto-play) の停止トグル用。
 * - playTtsSrc (aivis-cloud) と speakAuto (Web Speech API browser TTS) の両方が
 *   再生開始時に setPlaying(true)、終了時に setPlaying(false)
 * - TtsStopButton component が isPlaying を購読、再生中だけ表示
 * - button click で stopCurrentTts() (両 path 兼用) を呼ぶ
 */
import { create } from 'zustand';

export const useTtsStore = create((set) => ({
  isPlaying: false,
  setPlaying: (v) => set({ isPlaying: !!v }),
}));

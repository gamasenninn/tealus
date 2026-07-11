export const SCROLL_THRESHOLD = 50;
export const SCROLL_NEAR_BOTTOM = 100;
export const SCROLL_HEADER_OFFSET = 40;
export const INITIAL_SCROLL_DELAY = 50;
export const LONG_PRESS_TIMEOUT = 500;
export const TYPING_DEBOUNCE = 2000;
export const UPLOAD_DELAY = 2000;

export const FILE_SIZE_LIMITS = {
  image: 10,      // MB
  video: 1024,    // MB (1GB)
  default: 100,   // MB
};

// TTS (Aivis Cloud / Browser Speech Synthesis) は録音音声 / トランシーバーに比べ
// loudness が小さい傾向があるため compensate gain を掛ける。
// - Aivis Cloud / TtsButton (HTML audio + blob URL): Web Audio API GainNode で
//   1.0 を超える gain を適用可能 (例: voiceVolume 80% × 3.0 = 2.4 倍)
// - Browser TTS (Web Speech API): SpeechSynthesisUtterance.volume は 1.0 で
//   ハードキャップ、boost は適用するが超過分は捨てられる
// 値の調整目安:
//   2.0: トランシーバーよりまだ小さい (実機テストで判明、2026-04-28)
//   3.0: バランス取れる目安 (調整後)
//   4.0+: クリッピング / 歪みの可能性、要モニタ
export const TTS_VOLUME_BOOST = 3.0;

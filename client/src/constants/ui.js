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
// loudness が小さい傾向があるため compensate gain を掛ける。voiceVolume 80% で
// max (1.0) に達する目安。
export const TTS_VOLUME_BOOST = 1.25;

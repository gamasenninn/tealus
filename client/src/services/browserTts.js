/**
 * ブラウザ標準 TTS（Web Speech API）ラッパー
 *
 * #184 で導入。`TTS_PROVIDER=browser` 時の発声を担う。
 * Aivis Cloud + mediasoup と異なり、各端末ローカルで合成するため
 * mediasoup や API key 不要。
 */

let currentUtterance = null;
let cachedJaVoice = null;

function pickJaVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;
  // ja-JP が最優先、それ以外の ja* で fallback、最後に空でなければ先頭
  return (
    voices.find((v) => v.lang === 'ja-JP') ||
    voices.find((v) => v.lang && v.lang.startsWith('ja')) ||
    voices[0] ||
    null
  );
}

// voiceschanged は一部ブラウザで初回 getVoices() が空配列を返す問題に対応
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedJaVoice = pickJaVoice();
  };
  cachedJaVoice = pickJaVoice();
}

function speakInternal(text) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
  cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = cachedJaVoice || pickJaVoice();
  if (voice) u.voice = voice;
  u.lang = 'ja-JP';
  u.rate = 1.0;
  u.pitch = 1.0;
  const volPct = parseInt(localStorage.getItem('voiceVolume') || '80', 10);
  u.volume = Math.max(0, Math.min(1, volPct / 100));
  currentUtterance = u;
  u.onend = () => { if (currentUtterance === u) currentUtterance = null; };
  u.onerror = () => { if (currentUtterance === u) currentUtterance = null; };
  window.speechSynthesis.speak(u);
}

/**
 * 自動読み上げ用（ttsReadAloud フラグ ON 時のみ発声）
 */
export function speakAuto(text) {
  if (localStorage.getItem('ttsReadAloud') !== 'on') return;
  speakInternal(text);
}

/**
 * 個人ボタン用（ttsReadAloud フラグ無視で常に発声）
 */
export function speakNow(text) {
  speakInternal(text);
}

/**
 * 現在再生中の発声をキャンセル
 */
export function cancel() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  if (currentUtterance) {
    try { window.speechSynthesis.cancel(); } catch {}
    currentUtterance = null;
  }
}

export function isSupported() {
  return typeof window !== 'undefined' && !!window.speechSynthesis;
}

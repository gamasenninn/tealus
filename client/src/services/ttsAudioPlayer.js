/**
 * TTS 音声再生ヘルパー (Web Audio API による gain ブースト対応)
 *
 * HTML5 audio element の volume は 1.0 が上限のため、TTS の loudness が
 * 録音音声 / トランシーバーより小さく感じる場合に対処できない。
 * Web Audio API の GainNode は 1.0 超のゲインを掛けられる。
 *
 * 使い方:
 *   import { playTtsBlob, playTtsUrl } from '../services/ttsAudioPlayer';
 *   const audio = playTtsBlob(blob, { onEnded: () => {...} });
 *   // 戻り値の audio.pause() / audio.currentTime = 0 で停止可能
 */
import { TTS_VOLUME_BOOST } from '../constants/ui';
import { useTtsStore } from '../stores/ttsStore';

let audioContext = null;
function getAudioContext() {
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
  }
  // user gesture 後 resume が必要なケースに備える
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

// #243: 同時再生される TTS は 1 つに限定。新規再生時に以前の audio を stop し、
// store に isPlaying を反映する。stop button (TtsStopButton) はこの state を見る。
let currentAudio = null;

/**
 * 現在再生中の TTS を停止する (UI の stop button から呼ばれる)
 */
export function stopCurrentTts() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {}
    currentAudio = null;
  }
  useTtsStore.getState().setPlaying(false);
}

/**
 * 1 つの audio element + GainNode で再生 (blob URL or 直接 URL)
 *
 * @param {string} src URL (blob URL も可)
 * @param {object} opts
 * @param {() => void} [opts.onEnded]
 * @param {() => void} [opts.onError]
 * @returns {HTMLAudioElement} 制御用 audio 要素 (pause/currentTime 等)
 */
export function playTtsSrc(src, { onEnded, onError } = {}) {
  // #243: 既存再生があれば stop してから新規 start (同時再生 1 つに限定)
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.currentTime = 0; } catch {}
  }
  const audio = new Audio(src);
  currentAudio = audio;
  useTtsStore.getState().setPlaying(true);
  const volPct = parseInt(localStorage.getItem('voiceVolume') || '80', 10);
  const baseGain = Math.max(0, Math.min(1, volPct / 100)); // 0-1 の audio.volume 部分
  audio.volume = baseGain;

  // Web Audio API で 1.0 超の boost を適用 (audioCtx 取得できれば)
  const ctx = getAudioContext();
  if (ctx && TTS_VOLUME_BOOST > 1.0) {
    try {
      const source = ctx.createMediaElementSource(audio);
      const gainNode = ctx.createGain();
      // audio.volume × TTS_VOLUME_BOOST × 既に 1.0 cap している部分を超える分
      // base が 1.0 (= voiceVolume 100%) のとき gain = TTS_VOLUME_BOOST
      // base が 0.5 (= voiceVolume 50%) のとき gain = TTS_VOLUME_BOOST (audio.volume との積で 0.5 × BOOST)
      gainNode.gain.value = TTS_VOLUME_BOOST;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
    } catch (err) {
      // 失敗してもフォールバックで普通に再生される (ブースト無し)
      console.warn('[ttsAudioPlayer] Web Audio gain failed, fallback to native:', err.name);
    }
  }

  // #243: 終了時に store の isPlaying を false に + currentAudio クリア
  const handleEnded = () => {
    if (currentAudio === audio) {
      currentAudio = null;
      useTtsStore.getState().setPlaying(false);
    }
    if (onEnded) onEnded();
  };
  const handleError = (err) => {
    if (currentAudio === audio) {
      currentAudio = null;
      useTtsStore.getState().setPlaying(false);
    }
    if (onError) onError(err);
  };
  audio.addEventListener('ended', handleEnded);
  audio.addEventListener('error', handleError);

  audio.play().catch((err) => {
    console.warn('[ttsAudioPlayer] play blocked:', err.name);
    handleError(err);
  });

  return audio;
}

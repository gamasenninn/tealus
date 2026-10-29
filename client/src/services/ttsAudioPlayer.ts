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
import { notifyAudioStarted, subscribeAudioStarted } from '../utils/audioExclusive';
import { getSharedAudioContext } from './audioContext';

// ★ #562 AudioContext は画面で 1 つ (iPhone はタップの中で作らないと止まったまま)。TtsButton が押した直後に unlockAudio() する
const getAudioContext = getSharedAudioContext;

// #243: 同時再生される TTS は 1 つに限定。新規再生時に以前の audio を stop し、
// store に isPlaying を反映する。stop button (TtsStopButton) はこの state を見る。
let currentAudio: HTMLAudioElement | null = null;
/** 今の再生の後片付け (部品を外し、listener を外し、呼び出し側の onEnded を 1 回だけ呼ぶ) */
let releaseCurrent: (() => void) | null = null;

/**
 * ★ #413 (#380 の宿題) 同時再生の規約に参加する。
 *
 * これまでは **独自の `currentAudio` で 1 つに絞っていただけ**で、規約 (`voice:started`) には
 *   参加していなかった。だから音声メッセージや会話モードと**重なって鳴っていた**。
 * ★ 参加 = (1) 自分が鳴ることを知らせる (2) 他が鳴り始めたら止まる の両方。
 */
let unsubscribeOther: (() => void) | null = null;
let playCounter = 0;

/**
 * 現在再生中の TTS を停止する (UI の stop button から呼ばれる)
 */
export function stopCurrentTts(): void {
  if (unsubscribeOther) { unsubscribeOther(); unsubscribeOther = null; }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {}
    currentAudio = null;
  }
  if (releaseCurrent) { const r = releaseCurrent; releaseCurrent = null; r(); }
  useTtsStore.getState().setPlaying(false);
}

export interface PlayTtsOptions {
  onEnded?: () => void;
  onError?: (err?: unknown) => void;
}

/**
 * 1 つの audio element + GainNode で再生 (blob URL or 直接 URL)
 *
 * @param src URL (blob URL も可)
 * @param opts onEnded / onError callback
 * @returns 制御用 audio 要素 (pause/currentTime 等)
 */
export function playTtsSrc(src: string, { onEnded, onError }: PlayTtsOptions = {}): HTMLAudioElement {
  // #243: 既存再生があれば stop してから新規 start (同時再生 1 つに限定)
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.currentTime = 0; } catch {}
  }
  if (releaseCurrent) { const r = releaseCurrent; releaseCurrent = null; r(); }
  const audio = new Audio(src);
  currentAudio = audio;
  useTtsStore.getState().setPlaying(true);

  // ★ 規約に乗る (#413)。自分の id では止まらない (subscribeAudioStarted が selfId を無視する)
  const selfId = `tts:${++playCounter}`;
  if (unsubscribeOther) unsubscribeOther();
  unsubscribeOther = subscribeAudioStarted(selfId, () => stopCurrentTts());
  notifyAudioStarted(selfId);
  const volPct = parseInt(localStorage.getItem('voiceVolume') || '80', 10);
  const baseGain = Math.max(0, Math.min(1, volPct / 100)); // 0-1 の audio.volume 部分
  audio.volume = baseGain;

  // Web Audio API で 1.0 超の boost を適用 (audioCtx 取得できれば)
  const ctx = getAudioContext();
  const wired: AudioNode[] = [];
  if (ctx && TTS_VOLUME_BOOST > 1.0) {
    try {
      const source = ctx.createMediaElementSource(audio);
      const gainNode = ctx.createGain();
      wired.push(source, gainNode);
      // audio.volume × TTS_VOLUME_BOOST × 既に 1.0 cap している部分を超える分
      // base が 1.0 (= voiceVolume 100%) のとき gain = TTS_VOLUME_BOOST
      // base が 0.5 (= voiceVolume 50%) のとき gain = TTS_VOLUME_BOOST (audio.volume との積で 0.5 × BOOST)
      gainNode.gain.value = TTS_VOLUME_BOOST;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
    } catch (err) {
      // 失敗してもフォールバックで普通に再生される (ブースト無し)
      console.warn('[ttsAudioPlayer] Web Audio gain failed, fallback to native:', err instanceof Error ? err.name : String(err));
    }
  }

  // ★ 後片付け (2026-10-29 改善ループ 23 回目)。以前はつないだ部品を外さず、MediaElementSource が audio 要素を掴んだまま
  //   読み込んだ音声ごと画面を閉じるまで残った。次の読み上げ・停止で止められた方は onEnded も呼ばれず、blob URL が残った
  let released = false;
  const release = (cb?: () => void) => {
    if (released) return;
    released = true;
    if (releaseCurrent === releaseThis) releaseCurrent = null;
    audio.removeEventListener('ended', handleEnded);
    audio.removeEventListener('error', handleErrorEvent);
    for (const n of wired) { try { n.disconnect(); } catch {} }
    if (cb) cb();
  };
  // #243: 終了時に store の isPlaying を false に + currentAudio クリア
  const handleEnded = () => {
    if (currentAudio === audio) {
      currentAudio = null;
      useTtsStore.getState().setPlaying(false);
      if (unsubscribeOther) { unsubscribeOther(); unsubscribeOther = null; }
    }
    release(onEnded);
  };
  const handleError = (err?: unknown) => {
    if (currentAudio === audio) {
      currentAudio = null;
      useTtsStore.getState().setPlaying(false);
      if (unsubscribeOther) { unsubscribeOther(); unsubscribeOther = null; }
    }
    release(onError ? () => onError(err) : undefined);
  };
  const handleErrorEvent = (e: Event) => handleError(e);
  // 止められたとき (次の読み上げ・停止ボタン) は、最後まで鳴ったときと同じ後片付け
  const releaseThis = () => release(onEnded);
  releaseCurrent = releaseThis;
  audio.addEventListener('ended', handleEnded);
  audio.addEventListener('error', handleErrorEvent);

  audio.play().catch((err: unknown) => {
    console.warn('[ttsAudioPlayer] play blocked:', err instanceof Error ? err.name : String(err));
    handleError(err);
  });

  return audio;
}

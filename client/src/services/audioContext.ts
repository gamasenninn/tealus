/**
 * #562 画面で 1 つの AudioContext (録音とトランシーバーの音量ゲージ・読み上げの音量ブースト)。
 *
 * ★ iPhone (iOS) は AudioContext を**タップの処理の中で**作る / resume しないと止まったまま (suspended) になる。
 *   以前はそれぞれが await (マイクの許可・音声の合成待ち) の後で new AudioContext() していた = タップの外。
 *   ゲージは 0 のまま、読み上げは無音になりえた (2026-05-04 の音声メモ「iPhone の方は音声ゲージが出ない」)。
 * ★ 使い方: ボタンの onClick の**最初** (await より前) で unlockAudio() を呼ぶ。中身は getSharedAudioContext() で取る。
 * ★ 共有なので close しない。使い終わったら、つないだ部品 (source / analyser) を disconnect する。
 * ★ AudioContext を作るのはここだけ (__tests__/services/audioContext.test.ts が見張る)。
 */
let ctx: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  if (!ctx) {
    const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** タップの処理の最初 (await より前) に呼ぶ。iPhone で AudioContext を動かし始めるため */
export function unlockAudio(): void {
  try { getSharedAudioContext(); } catch { /* 作れない環境では何もしない */ }
}

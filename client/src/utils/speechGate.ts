/**
 * #405 AI が話しているかの判定 (docs/08 §12.6 の計器)。
 *
 * ★ 実測 (2026-09-05、8 往復) で踏んだ形:
 *   立ち上がり検知が **301 回**出た。しきい値をまたぐたびに切り替えていたので、
 *   **言葉の切れ目を毎回「話し終わった」と拾っていた**。
 *
 * ★ 基準① (2 秒) は「離してから**最初の**立ち上がり」を見るので、この不具合の影響を受けない。
 *   壊れていたのは「何秒話したか」と、画面の「話しています」表示の方。
 *   → **数字が全部おかしいのではなく、どの数字がおかしいかを分けて見ること。**
 *
 * 規則は 2 つだけ:
 *   - `onThreshold` を超えたら **即座に**「話している」(立ち上がりは遅らせない = 計器を鈍らせない)
 *   - `offThreshold` を下回る状態が `holdMs` **続いて初めて**「終わった」
 */
export interface SpeechGateOptions {
  /** これを超えたら話し始めたと見なす */
  onThreshold: number;
  /** これを下回ったら静かと見なす (立ち上がりより低くしてバタつきを抑える) */
  offThreshold: number;
  /** 静かな状態がこれだけ続いたら「終わった」にする (ms) */
  holdMs: number;
}

export interface SpeechGate {
  /** 音量と時刻を渡して、今「話している」かを返す */
  feed: (rms: number, nowMs: number) => boolean;
  reset: () => void;
}

export function createSpeechGate(opts: SpeechGateOptions): SpeechGate {
  let speaking = false;
  let lastLoudAt = 0;

  return {
    feed(rms, nowMs) {
      if (rms > opts.onThreshold) {
        speaking = true;
        lastLoudAt = nowMs;
      } else if (speaking) {
        // ★ 中くらいの音は「まだ続いている」に数える。ここを厳しくすると切れ目で切れる
        if (rms > opts.offThreshold) lastLoudAt = nowMs;
        else if (nowMs - lastLoudAt >= opts.holdMs) speaking = false;
      }
      return speaking;
    },
    reset() { speaking = false; lastLoudAt = 0; },
  };
}

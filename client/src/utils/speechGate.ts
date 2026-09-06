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

/**
 * #415 「話しています」の見せ方を、2 つの信号から決める。
 *
 * ★ 問題: `SpeechGate` だけだと **400ms を超える発話の切れ目**で消えて出る
 *   (実測で 1 応答あたり中央値 4 回、計測ログの 64% がこの上下だった)。
 *
 * ★★ そこで **サーバ側の「応答の音声を配信中か」** と合わせる。ただし
 *   **立ち上がりの印だけは門 (AnalyserNode) が鳴った時に出す** ——
 *   配信開始の合図で前倒しすると、**基準① の計器が AnalyserNode でなくなる**
 *   (#410 で「AnalyserNode を正」と決めた判断が、表示直しのついでに崩れる)。
 *
 * ```
 * 表示        門が鳴っている または 配信中
 * 立ち上がり   ★ 門だけ。1 つの応答につき 1 回
 * 終わり      両方が落ちてから (★ 配信の終わりの合図が来なくても、門が落ちれば終われる)
 * ```
 */
export interface SpeakingView {
  /** 門の判定と「配信中か」を渡し、表示すべき状態と、計測に残す印を返す */
  update: (gateSpeaking: boolean, playing: boolean) => { shown: boolean; mark: 'start' | 'end' | null };
  reset: () => void;
}

export function createSpeakingView(): SpeakingView {
  let shown = false;
  let startMarked = false;

  return {
    update(gateSpeaking, playing) {
      const next = gateSpeaking || playing;
      let mark: 'start' | 'end' | null = null;

      // ★ 立ち上がりは門が鳴ったときだけ。1 つの応答につき 1 回
      if (gateSpeaking && !startMarked) {
        startMarked = true;
        mark = 'start';
      } else if (!next && shown) {
        // ★ 終わりは両方落ちてから。印を出したかに関わらず、次の応答のために戻す
        if (startMarked) mark = 'end';
        startMarked = false;
      }
      shown = next;
      return { shown, mark };
    },
    reset() { shown = false; startMarked = false; },
  };
}

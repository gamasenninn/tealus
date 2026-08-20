import { useEffect, useRef } from 'react';
import { notifyAudioStarted, notifyAudioStopped, subscribeAudioStarted } from '../utils/audioExclusive';

export interface ExclusiveAudio {
  /** <audio> に挿す ref */
  ref: React.MutableRefObject<HTMLAudioElement | null>;
  /** <audio onPlay={...}> */
  onPlay: () => void;
  /** <audio onPause={...}> */
  onPause: () => void;
}

/**
 * 標準の `<audio controls>` を 同時再生抑制の規約に参加させる (#380)。
 *
 * ```tsx
 * const ex = useExclusiveAudio(media.id);
 * <audio ref={ex.ref} onPlay={ex.onPlay} onPause={ex.onPause} controls src={...} />
 * ```
 *
 * ★ 「なぜ止まったか」を区別するのがこの hook の本体。他の再生に止められた pause で
 *   `voice:stop-continuous` を投げると、**直前に相手が取った Wake Lock を解放**して
 *   しまう (`useVoiceContinuousPlay` が started で取得・stop-continuous で解放するため)。
 *   → 他に止められた直後の pause は 1 回だけ通知を抑止する。
 *
 * @param id 再生単位で一意な識別子 (message id / media id のどちらでもよい)
 */
export function useExclusiveAudio(id: string): ExclusiveAudio {
  const ref = useRef<HTMLAudioElement | null>(null);
  // 他に止められたことによる pause かどうか。pause イベントは非同期に来るのでフラグで渡す
  const pausedByOther = useRef(false);

  useEffect(() => subscribeAudioStarted(id, () => {
    const el = ref.current;
    if (!el) return;
    pausedByOther.current = true;
    el.pause();
  }), [id]);

  return {
    ref,
    onPlay: () => {
      pausedByOther.current = false;
      notifyAudioStarted(id);
    },
    onPause: () => {
      if (pausedByOther.current) {
        pausedByOther.current = false;   // 抑止は 1 回だけ
        return;
      }
      notifyAudioStopped();
    },
  };
}

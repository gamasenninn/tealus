import { useEffect, useRef } from 'react';
import { notifyAudioStarted, notifyAudioStopped, subscribeAudioStarted, subscribeAudioSeek } from '../utils/audioExclusive';
import type { SeekRequest } from '../utils/audioExclusive';

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

  // ★ シーク要求 (2026-08-29)。通話履歴の時刻タグ / 10 秒送り・戻し から呼ばれる。
  //   ★ 相対の計算をここに置くのは、currentTime を知っているのが要素を持つ側だから。
  useEffect(() => subscribeAudioSeek(id, (req: SeekRequest) => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      // duration は metadata 前だと NaN。★ NaN と比較すると常に false になるので明示的に外す
      const dur = Number.isFinite(el.duration) ? el.duration : Infinity;
      const next = 'to' in req ? req.to : el.currentTime + req.by;
      el.currentTime = Math.min(Math.max(next, 0), dur);
    };
    // preload="metadata" なので通常は読み込み済みだが、開いた直後に押されると 0 のことがある。
    // ★ readyState 0 で currentTime を書いても効かない (実装によっては例外) ので、一度だけ待つ。
    if (el.readyState === 0) el.addEventListener('loadedmetadata', apply, { once: true });
    else apply();
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

import { useExclusiveAudio } from '../../hooks/useExclusiveAudio';
import type { MediaItem } from '../../types';

interface MediaAudioProps {
  media: MediaItem;
  className?: string;
}

/**
 * 添付音声の再生バー (標準の `<audio controls>`)。
 *
 * ★ #376 でバブルに、#378 で編集モーダルに、同じ markup を 2 か所へ書いていた。
 *   #380 で 同時再生抑制の規約に参加させるにあたり、**参加の配線を 2 か所に複製しない**
 *   ため 1 つの部品にまとめた。以後、音声の添付を出したい場所はこれを使う。
 *
 * ★★ 規約への参加 = 他の音声が始まったら自分は止まる + Wake Lock の取得/解放にも乗る
 *   (`useExclusiveAudio` / `utils/audioExclusive` 参照)。識別子は **media id**:
 *   1 つのメッセージに音声が 2 つ付いていても、互いに止め合える。
 *
 * preload="metadata" — 1 room に何十件も並ぶので本体は先読みしない。尺とシークバーは出す。
 */
function MediaAudio({ media, className = 'media-audio' }: MediaAudioProps) {
  const ex = useExclusiveAudio(media.id);
  return (
    <audio
      ref={ex.ref}
      src={`/media/${media.file_path}`}
      controls
      preload="metadata"
      className={className}
      onPlay={ex.onPlay}
      onPause={ex.onPause}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export default MediaAudio;

import { parseTimestampMarks } from '../../utils/transcriptMarks';
import { requestAudioSeek } from '../../utils/audioExclusive';
import './TranscriptSeekBar.css';

interface TranscriptSeekBarProps {
  /** 編集中の本文。★ タグはここから毎回読み直す (編集で増減するため) */
  text: string;
  /** シーク先の音声。MediaAudio に渡している media.id と同じもの */
  audioId: string;
}

/**
 * 通話履歴の時刻タグへ飛ぶバー (2026-08-29)。
 *
 * ★ なぜ本文中のタグを直接押せないのか: 本文は `<textarea>` の中にあり、**textarea の中の
 *   文字はクリックできない**。したがって タグを外に取り出して並べる形にしている。
 *
 * ★ 高さは 1 行に固定する。スマホの編集はキーボードで縦が足りないので (#397)、
 *   ボタンを増やして段を足さない。10 秒送り/戻しは端に固定し、★ タグ側だけ横スクロールさせる。
 *
 * ★ 実際の seek は `voice:seek` の規約に投げるだけ。再生バーの実装 (標準 <audio controls> と
 *   手作りバー) が 2 系統あるので、配線を複製しないための形 (#380 と同じ考え方)。
 */
function TranscriptSeekBar({ text, audioId }: TranscriptSeekBarProps) {
  const marks = parseTimestampMarks(text);

  // ★ タグが無い便 (2026-08-29 17:45 より前 / 音声メッセージ) では 10 秒送り戻しだけ出す。
  //   バー自体を消さないのは、送り戻しはタグが無くても役に立つため。
  return (
    <div className="transcript-seek">
      <button type="button" className="tseek-btn" onClick={() => requestAudioSeek(audioId, { by: -10 })}>
        ⏪ 10秒
      </button>
      <button type="button" className="tseek-btn" onClick={() => requestAudioSeek(audioId, { by: 10 })}>
        10秒 ⏩
      </button>
      {marks.length > 0 && (
        <div className="tseek-marks">
          {marks.map((m) => (
            <button
              key={m.seconds}
              type="button"
              className="tseek-mark"
              onClick={() => requestAudioSeek(audioId, { to: m.seconds })}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default TranscriptSeekBar;

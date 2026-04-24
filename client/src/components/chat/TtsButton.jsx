import { useRef, memo } from 'react';
import { Volume2 } from 'lucide-react';
import { api } from '../../services/api';

// 個人TTS再生のシングルトン（同時再生防止、最後に押したものが優先）
let currentTtsAudio = null;
function stopCurrentTts() {
  if (currentTtsAudio) {
    try { currentTtsAudio.pause(); } catch {}
    currentTtsAudio = null;
  }
}

/**
 * メッセージの読み上げボタン（個人再生）。
 * React state を持たず、busyRef で多重クリック防止のみ行う。
 * 視覚フィードバックは一切なし（TTS 0.3〜0.5 秒で完了するため）。
 * classList 変更すら視覚ちらつきの原因になったため、DOM 変更も避ける。
 */
function TtsButton({ text, roomId }) {
  const audioRef = useRef(null);
  const busyRef = useRef(false);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!text || busyRef.current) return;

    // 同じボタン再タップ → トグル停止
    if (audioRef.current && audioRef.current === currentTtsAudio && !audioRef.current.paused) {
      stopCurrentTts();
      audioRef.current = null;
      return;
    }

    // 別の再生を停止
    stopCurrentTts();

    busyRef.current = true;
    try {
      const blob = await api.synthesizeTts(text, roomId);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const volumePct = parseInt(localStorage.getItem('voiceVolume') || '80', 10);
      audio.volume = Math.max(0, Math.min(1, volumePct / 100));
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (currentTtsAudio === audio) currentTtsAudio = null;
        audioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (currentTtsAudio === audio) currentTtsAudio = null;
        audioRef.current = null;
      };
      currentTtsAudio = audio;
      audioRef.current = audio;
      await audio.play();
    } catch (err) {
      console.error('TTS error:', err);
      alert('読み上げに失敗しました: ' + (err.message || ''));
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <button
      type="button"
      className="bubble-tts-btn"
      onClick={handleClick}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.stopPropagation()}
      title="読み上げ"
    >
      <Volume2 size={14} />
    </button>
  );
}

export default memo(TtsButton);

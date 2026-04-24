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
 * メッセージの読み上げボタン。
 * ちらつき防止のため React state を一切使わず、DOM を直接操作して
 * ローディング表示を制御する。再レンダー自体を発生させない。
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

// props が同じなら再レンダーしない（useState を除去したため、実質 props 変化でのみ再レンダー）
export default memo(TtsButton);

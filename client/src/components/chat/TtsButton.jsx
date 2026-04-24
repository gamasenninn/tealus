import { useState, useRef, memo } from 'react';
import { Volume2, Loader2 } from 'lucide-react';
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
 * state を本コンポーネントに閉じ込めることで、クリック時に
 * 親（MessageBubble）を再レンダーさせず、ちらつきを防ぐ。
 */
function TtsButton({ text, roomId }) {
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!text || loading) return;

    // 同じボタン再タップ → トグル停止
    if (audioRef.current && audioRef.current === currentTtsAudio && !audioRef.current.paused) {
      stopCurrentTts();
      audioRef.current = null;
      return;
    }

    // 別の再生を停止（最後に押したものを優先）
    stopCurrentTts();

    setLoading(true);
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
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      className={`bubble-tts-btn ${loading ? 'loading' : ''}`}
      onClick={handleClick}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.stopPropagation()}
      title="読み上げ"
    >
      {loading ? <Loader2 size={14} className="spin" /> : <Volume2 size={14} />}
    </button>
  );
}

// text と roomId が同じなら再レンダーしない（props 同一チェック）
export default memo(TtsButton);

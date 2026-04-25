import { useRef, memo } from 'react';
import { Volume2 } from 'lucide-react';
import { api } from '../../services/api';
import * as browserTts from '../../services/browserTts';
import { getConfig } from '../../services/clientConfig';

// 個人TTS再生のシングルトン（aivis-cloud 経路: 同時再生防止、最後に押したものが優先）
let currentTtsAudio = null;
function stopCurrentTts() {
  if (currentTtsAudio) {
    try { currentTtsAudio.pause(); } catch {}
    currentTtsAudio = null;
  }
}

/**
 * メッセージの読み上げボタン（個人再生）。
 * #184: TTS_PROVIDER で動作を分岐。
 *  - 'browser'     : Web Speech API で各端末ローカル再生
 *  - 'aivis-cloud' : 既存の REST API → WAV blob → <audio>
 *  - 'none'        : ボタン自体を非表示
 */
function TtsButton({ text, roomId }) {
  const audioRef = useRef(null);
  const busyRef = useRef(false);
  const provider = getConfig().tts_provider;

  // none provider: ボタン非表示
  if (provider === 'none') return null;

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!text || busyRef.current) return;

    if (provider === 'browser') {
      // 同じテキストの連打 = 停止トグル
      // (既存再生中に再度押すと cancel、その後新規再生)
      browserTts.cancel();
      browserTts.speakNow(text);
      return;
    }

    // 'aivis-cloud' (既存ロジック)
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

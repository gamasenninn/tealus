/**
 * TTS auto-play 停止 button (#243)
 *
 * AI 回答の音声応答 (aivis-cloud / browser TTS 両方) を任意停止する floating button。
 * useTtsStore の isPlaying を購読、再生中だけ表示。
 * Click で stopCurrentTts() (aivis-cloud) + cancel() (browser TTS) を両方呼ぶ。
 */
import { useTtsStore } from '../../stores/ttsStore';
import { stopCurrentTts } from '../../services/ttsAudioPlayer';
import { cancel as cancelBrowserTts } from '../../services/browserTts';
import { VolumeX } from 'lucide-react';
import './TtsStopButton.css';

function TtsStopButton() {
  const isPlaying = useTtsStore((s) => s.isPlaying);
  if (!isPlaying) return null;

  const handleStop = () => {
    stopCurrentTts();
    cancelBrowserTts();
  };

  return (
    <button
      className="tts-stop-button"
      onClick={handleStop}
      title="AI 音声応答を停止"
      aria-label="AI 音声応答を停止"
    >
      <VolumeX size={20} />
      <span className="tts-stop-label">音声を止める</span>
    </button>
  );
}

export default TtsStopButton;

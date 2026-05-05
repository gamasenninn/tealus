import { useState, useRef, useEffect } from 'react';
import { api } from '../../services/api';
import { useMessageStore } from '../../stores/messageStore';

/**
 * 文字起こし編集 modal — textarea の上に音声再生 slider を配置 (#248)
 *
 * user の編集中に再生位置を自由に control できるよう、VoiceBubble の
 * 既存 slider UI と同じ機構を modal 内に再現する。Phase 1 MVP として
 * 既存 logic を直書き、3 例目の重複が来たら共通 component 化検討 (yagni)。
 *
 * audioUrl 未指定でも動作 (slider 非表示で旧 modal と同等)。
 */
function VoiceEditModal({ messageId, initialText, audioUrl, onClose }) {
  const [editText, setEditText] = useState(initialText);
  const [saving, setSaving] = useState(false);

  // 音声再生 state (VoiceBubble から logic 移植)
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // user voiceVolume 設定を反映
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = (parseInt(localStorage.getItem('voiceVolume') || '80', 10)) / 100;
    }
  }, []);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.volume = (parseInt(localStorage.getItem('voiceVolume') || '80', 10)) / 100;
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
      setCurrentTime(audio.currentTime);
      setProgress((audio.currentTime / audio.duration) * 100);
    }
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (audio && isFinite(audio.duration)) setDuration(audio.duration);
  };

  const handleDurationChange = () => {
    const audio = audioRef.current;
    if (audio && isFinite(audio.duration)) setDuration(audio.duration);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
  };

  const handleSeek = (e) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    audio.currentTime = (x / rect.width) * audio.duration;
  };

  const formatTime = (s) => {
    if (!s || !isFinite(s)) return '0:00';
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min}:${String(sec).padStart(2, '0')}`;
  };

  const handleSave = async () => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      const data = await api.editTranscription(messageId, editText.trim());
      useMessageStore.getState().updateTranscription(messageId, {
        formatted_text: data.transcription.formatted_text,
        version: data.transcription.version,
        status: 'done',
      });
      onClose();
    } catch (err) {
      console.error('Edit error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box voice-edit-modal" onClick={e => e.stopPropagation()}>
        <h3>文字起こしを編集</h3>

        {/* #248: textarea の上に再生 slider を配置、編集しながら音声を seek 可能に */}
        {audioUrl && (
          <div className="voice-edit-player">
            <audio
              ref={audioRef}
              src={audioUrl}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onDurationChange={handleDurationChange}
              onEnded={handleEnded}
              preload="metadata"
            />
            <button
              type="button"
              className="voice-edit-play-btn"
              onClick={handlePlayPause}
              aria-label={isPlaying ? '一時停止' : '再生'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <div className="voice-edit-progress" onClick={handleSeek}>
              <div className="voice-edit-progress-track">
                <div className="voice-edit-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <span className="voice-edit-time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        )}

        <textarea
          value={editText}
          onChange={e => setEditText(e.target.value)}
          rows={6}
          autoFocus
        />
        <div className="voice-edit-buttons">
          <button className="btn-cancel" onClick={onClose}>キャンセル</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '確定'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default VoiceEditModal;

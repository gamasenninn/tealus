import { useState, useRef, useEffect } from 'react';
import { api } from '../../services/api';
import { useMessageStore } from '../../stores/messageStore';
import './VoiceBubble.css';

function VoiceBubble({ message, media, transcription, isOwn }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const audioRef = useRef(null);

  // Listen for edit/history trigger from context menu
  useEffect(() => {
    const editHandler = (e) => {
      if (e.detail.messageId === message.id) handleStartEdit();
    };
    const historyHandler = (e) => {
      if (e.detail.messageId === message.id) handleShowHistory();
    };
    window.addEventListener('voice:edit', editHandler);
    window.addEventListener('voice:history', historyHandler);
    return () => {
      window.removeEventListener('voice:edit', editHandler);
      window.removeEventListener('voice:history', historyHandler);
    };
  }, [message.id, transcription]);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); } else { audio.play(); }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
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

  const handleEnded = () => { setIsPlaying(false); setProgress(0); };

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

  const handleStartEdit = () => {
    setEditText(transcription?.formatted_text || transcription?.raw_text || '');
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      const data = await api.editTranscription(message.id, editText.trim());
      useMessageStore.getState().updateTranscription(message.id, {
        formatted_text: data.transcription.formatted_text,
        version: data.transcription.version,
        status: 'done',
      });
      setIsEditing(false);
    } catch (err) {
      console.error('Edit error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleShowHistory = async () => {
    try {
      const data = await api.getTranscriptionHistory(message.id);
      setHistory(data.history);
      setShowHistory(true);
    } catch (err) {
      console.error('History error:', err);
    }
  };

  const filePath = media?.[0]?.file_path;
  if (!filePath) return null;

  const displayText = transcription?.formatted_text || transcription?.raw_text;

  return (
    <div className="voice-bubble">
      <audio
        ref={audioRef}
        src={`/media/${filePath}`}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleDurationChange}
        onEnded={handleEnded}
        preload="metadata"
      />
      <button className="voice-play-btn" onClick={handlePlayPause}>
        {isPlaying ? '⏸' : '▶'}
      </button>
      <div className="voice-progress-area" onClick={handleSeek}>
        <div className="voice-progress-track">
          <div className="voice-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="voice-duration">{formatTime(duration)}</span>
      </div>

      {transcription && (
        <div className="voice-transcription">
          {transcription.status === 'pending' && <span className="voice-trans-status">⏳ 処理中...</span>}
          {transcription.status === 'transcribing' && <span className="voice-trans-status">⏳ 文字起こし中...</span>}
          {transcription.status === 'formatting' && <span className="voice-trans-status">⏳ AIが文章を整えています...</span>}
          {transcription.status === 'done' && !isEditing && (
            <>
              <span className="voice-trans-text">📝 {displayText}</span>
              {isOwn && (
                <div className="voice-trans-actions">
                  <button className="voice-edit-btn" onClick={handleStartEdit}>編集</button>
                  {transcription.version > 1 && (
                    <button className="voice-history-btn" onClick={handleShowHistory}>履歴</button>
                  )}
                </div>
              )}
            </>
          )}
          {transcription.status === 'done' && isEditing && (
            <div className="voice-edit-overlay" onClick={() => setIsEditing(false)}>
              <div className="voice-edit-modal" onClick={e => e.stopPropagation()}>
                <h3>文字起こしを編集</h3>
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  rows={6}
                  autoFocus
                />
                <div className="voice-edit-buttons">
                  <button className="voice-edit-cancel" onClick={() => setIsEditing(false)}>キャンセル</button>
                  <button className="voice-edit-save" onClick={handleSaveEdit} disabled={saving}>
                    {saving ? '保存中...' : '確定'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {transcription.status === 'error' && <span className="voice-trans-error">⚠ 文字起こしできませんでした</span>}
        </div>
      )}

      {showHistory && (
        <div className="voice-history-overlay" onClick={() => setShowHistory(false)}>
          <div className="voice-history-modal" onClick={e => e.stopPropagation()}>
            <h3>文字起こし編集履歴</h3>
            <div className="voice-history-list">
              {history.map(h => (
                <div key={h.version} className="voice-history-item">
                  <span className="voice-history-version">v{h.version}</span>
                  <span className="voice-history-text">{h.formatted_text || h.raw_text}</span>
                  {h.edited_by_name && <span className="voice-history-editor">by {h.edited_by_name}</span>}
                </div>
              ))}
            </div>
            <button className="voice-history-close" onClick={() => setShowHistory(false)}>閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default VoiceBubble;

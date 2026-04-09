import { useState, useRef, useEffect } from 'react';
import { api } from '../../services/api';
import VoiceEditModal from './VoiceEditModal';
import VoiceHistoryModal from './VoiceHistoryModal';
import './VoiceBubble.css';

function VoiceBubble({ message, media, transcription, isOwn, canEditTranscription, replyMessage, searchKeyword }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const audioRef = useRef(null);

  // Listen for edit/history/play trigger
  useEffect(() => {
    const editHandler = (e) => {
      if (e.detail.messageId === message.id) handleStartEdit();
    };
    const historyHandler = (e) => {
      if (e.detail.messageId === message.id) handleShowHistory();
    };
    const playHandler = (e) => {
      if (e.detail.messageId === message.id) {
        const audio = audioRef.current;
        if (audio) { audio.play(); setIsPlaying(true); }
      }
    };
    window.addEventListener('voice:edit', editHandler);
    window.addEventListener('voice:history', historyHandler);
    window.addEventListener('voice:play', playHandler);
    return () => {
      window.removeEventListener('voice:edit', editHandler);
      window.removeEventListener('voice:history', historyHandler);
      window.removeEventListener('voice:play', playHandler);
    };
  }, [message.id, transcription]);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      // 再生中に押すと連続再生も止める
      window.dispatchEvent(new CustomEvent('voice:stop-continuous'));
    } else {
      audio.play();
    }
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

  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
    if (localStorage.getItem('voiceContinuousPlay') === 'true') {
      window.dispatchEvent(new CustomEvent('voice:ended', { detail: { messageId: message.id } }));
    }
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

  const handleStartEdit = () => {
    setIsEditing(true);
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

  const highlightText = (text) => {
    if (!text || !searchKeyword) return text;
    const escaped = searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      i % 2 === 1 ? <mark key={i} className="search-highlight">{part}</mark> : part
    );
  };

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

      {replyMessage && (
        <div className="bubble-reply" style={{ flexBasis: '100%' }}>
          <span className="bubble-reply-sender">{replyMessage.sender_display_name}</span>
          <span className="bubble-reply-content">{replyMessage.content || '(メディア)'}</span>
        </div>
      )}

      {transcription && (
        <div className="voice-transcription">
          {transcription.status === 'pending' && <span className="voice-trans-status">⏳ 処理中...</span>}
          {transcription.status === 'transcribing' && <span className="voice-trans-status">⏳ 文字起こし中...</span>}
          {transcription.status === 'formatting' && <span className="voice-trans-status">⏳ AIが文章を整えています...</span>}
          {transcription.status === 'done' && (
            <>
              <span className="voice-trans-text">{highlightText(displayText)}</span>
              {canEditTranscription && (
                <div className="voice-trans-actions">
                  <button className="voice-edit-btn" onClick={handleStartEdit}>編集</button>
                  {transcription.version > 1 && (
                    <button className="voice-history-btn" onClick={handleShowHistory}>履歴</button>
                  )}
                </div>
              )}
            </>
          )}
          {transcription.status === 'error' && <span className="voice-trans-error">⚠ 文字起こしできませんでした</span>}
        </div>
      )}

      {isEditing && (
        <VoiceEditModal
          messageId={message.id}
          initialText={transcription?.formatted_text || transcription?.raw_text || ''}
          onClose={() => setIsEditing(false)}
        />
      )}

      {showHistory && (
        <VoiceHistoryModal
          history={history}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

export default VoiceBubble;

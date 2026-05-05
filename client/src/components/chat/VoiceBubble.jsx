import { useState, useRef, useEffect, memo } from 'react';
import { api } from '../../services/api';
import { useConfirm } from '../../stores/confirmStore';
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
  const [isRetranscribing, setIsRetranscribing] = useState(false);
  const audioRef = useRef(null);
  const confirm = useConfirm();

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

  // 音声レベル設定を反映
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = (parseInt(localStorage.getItem('voiceVolume') || '80')) / 100;
    }
  }, []);

  // 他の音声が再生開始したら自分を停止
  useEffect(() => {
    const handleOtherPlay = (e) => {
      if (e.detail.messageId !== message.id && isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
        setProgress(0);
      }
    };
    window.addEventListener('voice:started', handleOtherPlay);
    return () => window.removeEventListener('voice:started', handleOtherPlay);
  }, [message.id, isPlaying]);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      window.dispatchEvent(new CustomEvent('voice:stop-continuous'));
    } else {
      // 他の再生を止めてから自分を再生
      window.dispatchEvent(new CustomEvent('voice:started', { detail: { messageId: message.id } }));
      audio.volume = (parseInt(localStorage.getItem('voiceVolume') || '80')) / 100;
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

  // #216: 再文字起こし
  const handleRetranscribe = async () => {
    const ok = await confirm({
      body: '再文字起こしを実行します。少し時間がかかります。',
      okLabel: '実行',
    });
    if (!ok) return;

    setIsRetranscribing(true);
    try {
      await api.retranscribeVoiceMessage(message.id);
      // status は Socket.IO の voice:status / voice:transcription event で更新されるので、
      // ここでは何もしない (transcription は親から再受信)
    } catch (err) {
      console.error('Retranscribe error:', err);
      alert('再文字起こしに失敗しました: ' + (err.message || 'Unknown error'));
    } finally {
      setIsRetranscribing(false);
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
        <div
          className="bubble-reply"
          style={{ flexBasis: '100%' }}
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('message:scroll-to', { detail: { id: replyMessage.id } }));
          }}
        >
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
                  <button className="voice-retranscribe-btn" onClick={handleRetranscribe} disabled={isRetranscribing}>
                    {isRetranscribing ? '再実行中...' : '再文字起こし'}
                  </button>
                  {transcription.version > 1 && (
                    <button className="voice-history-btn" onClick={handleShowHistory}>履歴</button>
                  )}
                </div>
              )}
            </>
          )}
          {transcription.status === 'error' && (
            <>
              <span className="voice-trans-error">⚠ 文字起こしできませんでした</span>
              {canEditTranscription && (
                <div className="voice-trans-actions">
                  <button className="voice-retranscribe-btn" onClick={handleRetranscribe} disabled={isRetranscribing}>
                    {isRetranscribing ? '再実行中...' : '再文字起こし'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {isEditing && (
        <VoiceEditModal
          messageId={message.id}
          initialText={transcription?.formatted_text || transcription?.raw_text || ''}
          audioUrl={`/media/${filePath}`}
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

// MessageBubble の state 変化（textExpanded, contextMenu 等）での
// 不要な再レンダーを防止。message 関連の実質的な変化でのみ re-render。
export default memo(VoiceBubble, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.is_edited === next.message.is_edited &&
    prev.transcription?.formatted_text === next.transcription?.formatted_text &&
    prev.transcription?.raw_text === next.transcription?.raw_text &&
    prev.transcription?.status === next.transcription?.status &&
    prev.transcription?.version === next.transcription?.version &&
    prev.isOwn === next.isOwn &&
    prev.canEditTranscription === next.canEditTranscription &&
    prev.searchKeyword === next.searchKeyword &&
    prev.replyMessage?.id === next.replyMessage?.id &&
    JSON.stringify(prev.media) === JSON.stringify(next.media)
  );
});

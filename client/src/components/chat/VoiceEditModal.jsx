import { useState, useRef, useEffect } from 'react';
import { api } from '../../services/api';
import { useMessageStore } from '../../stores/messageStore';
import { useRoomStore } from '../../stores/roomStore';
import { useAuthStore } from '../../stores/authStore';
import { voiceNav, transcriptionText } from '../../utils/voiceNav';

/**
 * 文字起こし編集 modal — 連続編集対応 (前/次で隣の音声へ移動、戻るで閉じる)。
 *
 * モーダルを開いたまま、ルームの編集可能な音声メッセージ (status=done) を
 * 前/次 で送りながら連続編集できる。未保存の編集は移動/閉じる時に自動保存する。
 * 音声プレイヤー (#248) は対象切替時に reset。ナビ判定は utils/voiceNav に分離。
 */
function VoiceEditModal({ messageId, onClose }) {
  const messages = useMessageStore((s) => s.messages);
  const currentRoom = useRoomStore((s) => s.currentRoom);
  const userId = useAuthStore((s) => s.user?.id);
  const allowMemberEdit = !!currentRoom?.allow_member_transcription_edit;

  const [currentId, setCurrentId] = useState(messageId);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  // 音声再生 state (#248)
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const nav = voiceNav(messages, currentId, userId, allowMemberEdit);
  const current = nav.current;
  const originalText = transcriptionText(current);
  const filePath = current?.media?.[0]?.file_path;
  const audioUrl = filePath ? `/media/${filePath}` : null;
  const dirty = editText.trim() !== originalText.trim();

  // 対象切替 (初期表示含む) でテキストと音声 state を読み直す
  useEffect(() => {
    setEditText(originalText);
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    if (audioRef.current) {
      audioRef.current.volume = (parseInt(localStorage.getItem('voiceVolume') || '80', 10)) / 100;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

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

  // 現在の編集を保存 (変更が無ければ no-op、無駄な version 増加を防ぐ)
  const saveCurrent = async () => {
    const text = editText.trim();
    if (!text || text === originalText.trim()) return;
    setSaving(true);
    try {
      const data = await api.editTranscription(currentId, text);
      useMessageStore.getState().updateTranscription(currentId, {
        formatted_text: data.transcription.formatted_text,
        version: data.transcription.version,
        status: 'done',
      });
    } catch (err) {
      console.error('Edit error:', err);
    } finally {
      setSaving(false);
    }
  };

  // 前/次へ移動 (未保存は自動保存してから)
  const goTo = async (targetId) => {
    if (!targetId || saving) return;
    await saveCurrent();
    setCurrentId(targetId);
  };

  // 確定: 保存して開いたまま (連続編集前提)
  const handleConfirm = async () => {
    await saveCurrent();
  };

  // 戻る: 未保存なら保存してから閉じる
  const handleBack = async () => {
    await saveCurrent();
    onClose();
  };

  if (!current) {
    // 対象が見つからない (削除等) → 閉じる
    return null;
  }

  return (
    <div className="modal-overlay" onClick={handleBack}>
      <div className="modal-box voice-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="voice-edit-header">
          <h3>文字起こしを編集</h3>
          {nav.total > 1 && (
            <span className="voice-edit-position">{nav.index + 1} / {nav.total}</span>
          )}
        </div>

        {/* #248: textarea の上に再生 slider を配置、編集しながら音声を seek 可能に */}
        {audioUrl && (
          <div className="voice-edit-player">
            <audio
              key={currentId}
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
          key={currentId}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          rows={6}
          autoFocus
        />

        {/* 連続編集ナビ: 前/次 で隣の音声へ (未保存は自動保存) */}
        <div className="voice-edit-nav">
          <button
            type="button"
            className="btn-nav"
            onClick={() => goTo(nav.prevId)}
            disabled={!nav.prevId || saving}
          >
            ← 前
          </button>
          <button
            type="button"
            className="btn-nav"
            onClick={() => goTo(nav.nextId)}
            disabled={!nav.nextId || saving}
          >
            次 →
          </button>
        </div>

        <div className="voice-edit-buttons">
          <button className="btn-cancel" onClick={handleBack}>戻る</button>
          <button className="btn-primary" onClick={handleConfirm} disabled={saving || !dirty}>
            {saving ? '保存中...' : '確定'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default VoiceEditModal;

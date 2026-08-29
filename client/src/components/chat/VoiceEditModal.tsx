import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../services/api';
import TranscriptSeekBar from '../media/TranscriptSeekBar';
import { useMessageStore } from '../../stores/messageStore';
import { useRoomStore } from '../../stores/roomStore';
import { useAuthStore } from '../../stores/authStore';
import { voiceNav, navFor, transcriptionText } from '../../utils/voiceNav';
import type { Message, Room } from '../../types';
import { notifyAudioStarted, notifyAudioStopped, subscribeAudioStarted } from '../../utils/audioExclusive';
import { formatDuration } from '../../utils/format';

interface VoiceEditModalProps {
  messageId: string;
  onClose: () => void;
  /**
   * #379 注入点 (すべて省略可 = 従来の音声メッセージ用の挙動)。
   *
   * ★ 添付音声つきメッセージからも同じモーダルを使うために開けた口。連続編集の実装を
   *   2 つ持たないための形で、**省略時の経路は 1 行も変わらない**。
   */
  /** 対象一覧の選び方 (省略時: 編集可能な voice)。★ store の購読はモーダル側に閉じる */
  selectItems?: (messages: Message[], userId: string, room: Room | null) => Message[];
  textOf?: (m: Message | null) => string;              // 本文の取り出し
  save?: (id: string, text: string) => Promise<void>;  // 保存
  renderPlayer?: (m: Message) => ReactNode;            // 再生バー
  /** ★ 時刻タグのシーク先 (media id)。返せない経路 (音声メッセージ) は省略してよい */
  audioIdOf?: (m: Message) => string | null;
  title?: string;
}

/**
 * 文字起こし編集 modal — 連続編集対応 (前/次で隣の音声へ移動、戻るで閉じる)。
 *
 * モーダルを開いたまま、ルームの編集可能な音声メッセージ (status=done) を
 * 前/次 で送りながら連続編集できる。未保存の編集は移動/閉じる時に自動保存する。
 * 音声プレイヤー (#248) は対象切替時に reset。ナビ判定は utils/voiceNav に分離。
 *
 * ★ #379: 添付音声つきメッセージ (通話履歴等) からも使えるよう、一覧 / 本文 / 保存 /
 *   再生バー の 4 か所を注入できる。**省略時は従来どおり**。
 */
function VoiceEditModal({
  messageId, onClose, selectItems, textOf, save, renderPlayer, audioIdOf, title = '文字起こしを編集',
}: VoiceEditModalProps) {
  const messages = useMessageStore((s) => s.messages);
  const currentRoom = useRoomStore((s) => s.currentRoom);
  const userId = useAuthStore((s) => s.user?.id);
  const allowMemberEdit = !!currentRoom?.allow_member_transcription_edit;

  const [currentId, setCurrentId] = useState(messageId);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 音声再生 state (#248)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const nav = selectItems
    ? navFor(selectItems(messages, userId as string, currentRoom ?? null), currentId)
    : voiceNav(messages, currentId, userId as string, allowMemberEdit);
  const current = nav.current;
  const originalText = (textOf ?? transcriptionText)(current);
  const filePath = current?.media?.[0]?.file_path;
  const audioUrl = filePath ? `/media/${filePath}` : null;
  const dirty = editText.trim() !== originalText.trim();

  // 対象切替 (初期表示含む) でテキストと音声 state を読み直す
  useEffect(() => {
    setEditText(originalText);
    setSaveError(null);
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    if (audioRef.current) {
      audioRef.current.volume = (parseInt(localStorage.getItem('voiceVolume') || '80', 10)) / 100;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // ★ #380: 同時再生抑制の規約に参加する。この画面だけ参加しておらず、
  //   編集中に再生すると **裏のバブルが鳴りっぱなし**になり得た (VoiceBubble は参加済)。
  //   ここで止めるときは notifyAudioStopped を呼ばない —— 直前に相手が取った
  //   Wake Lock を解放してしまうため (useVoiceContinuousPlay)。
  useEffect(() => subscribeAudioStarted(currentId, () => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }), [currentId]);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      notifyAudioStopped();
    } else {
      notifyAudioStarted(currentId);
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

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    audio.currentTime = (x / rect.width) * audio.duration;
  };


  /**
   * 現在の編集を保存 (変更が無ければ no-op、無駄な version 増加を防ぐ)。
   *
   * ★ 無変更で保存しないのは親切ではなく要件 (#379): サーバは同値でも版を積み
   *   `is_edited` を立てるため、無変更保存は「人手訂正が確定した」の合図を偽装する。
   * ★★ 戻り値は成否。失敗したら **移動も終了もしない** —— 以前は握り潰して先へ進み、
   *   編集内容が黙って消えていた。
   */
  const saveCurrent = async (): Promise<boolean> => {
    const text = editText.trim();
    if (!text || text === originalText.trim()) return true;
    setSaving(true);
    setSaveError(null);
    try {
      if (save) { await save(currentId, text); return true; }   // #379: 注入された保存 (store 同期は呼び出し側)
      const data = await api.editTranscription(currentId, text);
      useMessageStore.getState().updateTranscription(currentId, {
        formatted_text: data.transcription.formatted_text,
        version: data.transcription.version,
        status: 'done',
      });
      return true;
    } catch (err) {
      console.error('Edit error:', err);
      setSaveError('保存できませんでした。通信状態や編集の権限を確認してください。');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // 前/次へ移動 (未保存は自動保存してから)
  const goTo = async (targetId: string | null) => {
    if (!targetId || saving) return;
    if (!await saveCurrent()) return;   // ★ 保存できていないなら移動しない
    setCurrentId(targetId);
  };

  // 確定: 保存して開いたまま (連続編集前提)
  const handleConfirm = async () => {
    await saveCurrent();
  };

  // 戻る: 未保存なら保存してから閉じる
  const handleBack = async () => {
    if (!await saveCurrent()) return;   // ★ 保存できていないなら閉じない (編集を捨てない)
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
          <h3>{title}</h3>
          {nav.total > 1 && (
            <span className="voice-edit-position">{nav.index + 1} / {nav.total}</span>
          )}
        </div>

        {/* #248: textarea の上に再生 slider を配置、編集しながら音声を seek 可能に */}
        {/* ★ #379: 再生バーは注入可 (添付音声は #380 の MediaAudio を渡す) */}
        {renderPlayer && current && renderPlayer(current)}
        {/* ★ 時刻タグへ飛ぶバー。添付音声の編集 (#379 の経路) でだけ出る。
            audioId は呼び出し側が渡す —— この modal は media の形を知らない */}
        {audioIdOf && current && audioIdOf(current) && (
          <TranscriptSeekBar text={editText} audioId={audioIdOf(current)!} />
        )}
        {!renderPlayer && audioUrl && (
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
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          </div>
        )}

        {saveError && <p className="voice-edit-error" role="alert">{saveError}</p>}

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

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { getSocket } from '../../services/socket';
import { api } from '../../services/api';
import { sendRoomMessage } from '../../services/sendRoomMessage';
import { useMessageStore } from '../../stores/messageStore';
import { useRoomStore } from '../../stores/roomStore';
import { useAgentStore } from '../../stores/agentStore';
import { useAuthStore } from '../../stores/authStore';
import { isAdmin } from '../../utils/permissions';
import { buildAgentPrefill, extractAgentBody } from '../../utils/agentPrefill';
import VoiceRecorder from './VoiceRecorder';
import StampPicker from '../stamp/StampPicker';
import MentionPicker from './MentionPicker';
import type { MentionCandidate } from './MentionPicker';
import { FILE_SIZE_LIMITS, TYPING_DEBOUNCE, UPLOAD_DELAY } from '../../constants/ui';
import { Mic } from 'lucide-react';
import type { Stamp } from '../../types';
import './MessageInput.css';

/** useTransceiver の返す制御 object のうち MessageInput が使う部分 */
interface TransceiverControls {
  isConnected: boolean;
  isProducing: boolean;
  startProducing: (track: MediaStreamTrack) => void;
  stopProducing: () => void;
}

interface MessageInputProps {
  roomId: string;
  transceiver?: TransceiverControls | null;
}

function MessageInput({ roomId, transceiver }: MessageInputProps) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [recorderStream, setRecorderStream] = useState<MediaStream | null>(null);
  const [showStamps, setShowStamps] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { replyTo, clearReplyTo, setReplyTo, pendingAgentMessage, clearPendingAgentMessage } = useMessageStore();
  const { members } = useRoomStore();
  // #338 Phase 1: アプリ内アシスタントの identity（🤖ボタンの宛先メンションに使う）
  const { assistantUserId, assistantName, fetchIdentity } = useAgentStore();
  useEffect(() => { fetchIdentity(); }, [fetchIdentity]);
  // アシスタントが当該ルームの member の時だけ🤖ボタンを出す（不在ルームで召喚を差し出さない）
  const assistantInRoom = !!assistantUserId && !!assistantName
    && members.some(m => m.user_id === assistantUserId);

  // 宛先選択後に埋める本文を保持（入口B。null なら入口A=ボタンでメンションのみ prepend）
  const [pendingAgentBody, setPendingAgentBody] = useState<string | null>(null);

  const focusTextareaEnd = useCallback(() => {
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }, 0);
  }, []);

  const [showAgentPicker, setShowAgentPicker] = useState(false);

  // #253: cc-proj を mention picker に virtual user として表示
  // #333: mount 時に加え、picker を開く遷移でも再取得（新規 cc project を reload なしで反映）
  const [ccProjects, setCcProjects] = useState<Array<{ name: string }>>([]);
  const refreshCcProjects = useCallback(() => {
    api.getCcProjects().then(d => setCcProjects(d.projects || [])).catch(() => {});
  }, []);
  useEffect(() => { refreshCcProjects(); }, [refreshCcProjects]);
  const mentionMembers = useMemo<MentionCandidate[]>(() => {
    const ccMembers = ccProjects.map(p => ({
      user_id: `cc:${p.name}`,
      display_name: `cc-${p.name}`,
      avatar_url: null,
      is_cc: true,
    }));
    return [...members, ...ccMembers];
  }, [members, ccProjects]);

  // #338 Phase 1: 🤖 の宛先候補 = アシスタント + (admin/AI班 のみ) cc-* 。既存 mention 候補と同ソース。
  // Q3: cc-* は一般ユーザーには出さず AI班のみ。管理者ロールを AI班の proxy として gate。
  const { user } = useAuthStore();
  const isAdminUser = isAdmin(user);
  const agentTargets = useMemo<MentionCandidate[]>(() => {
    if (!assistantName) return [];
    const list: MentionCandidate[] = [{ user_id: assistantUserId || 'assistant', display_name: assistantName, avatar_url: null }];
    if (isAdminUser) {
      list.push(...ccProjects.map(p => ({ user_id: `cc:${p.name}`, display_name: `cc-${p.name}`, avatar_url: null, is_cc: true })));
    }
    return list;
  }, [assistantName, assistantUserId, isAdminUser, ccProjects]);

  // 宛先を選んだら composer に反映。入口B(pendingAgentBody あり)は本文込みで置換、
  // 入口A(ボタン)は先頭にメンションのみ prepend（本文はユーザーが続けて打つ）。
  const insertAgentMention = useCallback((name: string) => {
    setShowAgentPicker(false);
    if (pendingAgentBody != null) {
      setText(`@${name} ${pendingAgentBody}`);
      setPendingAgentBody(null);
    } else {
      setText(prev => `@${name} ${prev}`);
    }
    focusTextareaEnd();
  }, [pendingAgentBody, focusTextareaEnd]);

  // 🤖ボタン: 宛先が複数(admin で cc-* あり)なら picker、単一ならアシスタント直挿入。
  const onAgentButtonClick = useCallback(() => {
    setPendingAgentBody(null);
    if (agentTargets.length > 1) setShowAgentPicker(v => !v);
    else if (assistantName) insertAgentMention(assistantName);
  }, [agentTargets, assistantName, insertAgentMention]);

  // 入口B: コンテキストメニュー「エージェントに送る」が対象 message を積んだら消費する。
  // admin で宛先が複数なら picker を開き（本文は pendingAgentBody に退避）、単一なら直 prefill。
  useEffect(() => {
    if (!pendingAgentMessage) return;
    const msg = pendingAgentMessage;
    clearPendingAgentMessage();
    setReplyTo(msg);
    if (agentTargets.length > 1) {
      setPendingAgentBody(extractAgentBody(msg));
      setShowAgentPicker(true);
    } else if (assistantName) {
      setText(buildAgentPrefill({ assistantName, message: msg }));
      focusTextareaEnd();
    }
  }, [pendingAgentMessage, clearPendingAgentMessage, setReplyTo, agentTargets.length, assistantName, focusTextareaEnd]);

  const emitTyping = () => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('typing:start', roomId);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socket.emit('typing:stop', roomId);
    }, TYPING_DEBOUNCE);
  };

  const handleSend = async () => {
    const content = text.trim();
    if (!content || isSending) return;

    setIsSending(true);
    try {
      // socket 優先 / REST fallback は sendRoomMessage に集約 (docs/05 §4 webhook 発火経路)
      await sendRoomMessage({ roomId, content, replyTo: replyTo?.id ?? null });
      setText('');
      // textarea の高さをリセット
      const textarea = document.querySelector<HTMLTextAreaElement>('.message-input-text');
      if (textarea) textarea.style.height = 'auto';
      clearReplyTo();
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      getSocket()?.emit('typing:stop', roomId);
    } catch (err) {
      console.error('Send error:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  // textarea 自動拡張
  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const textarea = e.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  };

  // ＋ボタン / 貼り付け 共用のアップロード処理
  const uploadFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;

    // Client-side file size check
    const limits = FILE_SIZE_LIMITS;
    for (const file of files) {
      const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'default';
      const maxMB = limits[type];
      if (file.size > maxMB * 1024 * 1024) {
        setUploadError(`${file.name || 'ファイル'} のサイズが上限（${maxMB}MB）を超えています`);
        setTimeout(() => setUploadError(''), 5000);
        return;
      }
    }

    setIsSending(true);
    setUploadProgress(0);
    setUploadError('');
    try {
      await api.uploadMedia(roomId, files, (progress) => {
        setUploadProgress(progress);
      });
      // Re-fetch messages and scroll to bottom
      await useMessageStore.getState().fetchMessages(roomId);
      window.dispatchEvent(new CustomEvent('scroll:bottom'));
      setTimeout(async () => {
        await useMessageStore.getState().fetchMessages(roomId);
        window.dispatchEvent(new CustomEvent('scroll:bottom'));
      }, 2000);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setUploadError(''), 5000);
    } finally {
      setIsSending(false);
      setUploadProgress(null);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    await uploadFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // クリップボード貼り付け (Ctrl+V) で画像/ファイルを ＋ボタンと同じ経路でアップロード
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (isSending) return;
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter((f): f is File => Boolean(f));
    if (files.length === 0) return; // テキスト等の貼り付けは従来どおり通す

    e.preventDefault();
    // スクショ等は name が無いことがあるので合成 (拡張子は mime から)
    const named = files.map((f, i) => {
      if (f.name) return f;
      const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      return new File([f], `pasted-${Date.now()}-${i}.${ext}`, { type: f.type });
    });
    uploadFiles(named);
  };

  const handleMicClick = async () => {
    // 事前チェック: insecure context (HTTPS 未対応) では mediaDevices が undefined になる
    if (!window.isSecureContext || !navigator.mediaDevices) {
      setUploadError('マイクの利用には HTTPS 接続が必要です。HTTPS で再度アクセスするか、管理者に確認してください。');
      setTimeout(() => setUploadError(''), 8000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setRecorderStream(stream);
      // トランシーバー ON ならユーザ↔ユーザ PTT 配信のため mediasoup にも流す
      if (transceiver?.isConnected) {
        transceiver.startProducing(stream.getAudioTracks()[0]);
      }
    } catch (err) {
      const e = err as { name?: string; message?: string };
      let message;
      if (e.name === 'NotAllowedError') {
        message = 'マイクへのアクセスがブラウザで拒否されました。ブラウザ設定でマイク許可を有効にしてください。';
      } else if (e.name === 'NotFoundError') {
        message = 'マイクが見つかりません。マイクを接続してから再度お試しください。';
      } else if (e.name === 'NotReadableError') {
        message = 'マイクが他のアプリで使用中の可能性があります。他のアプリを閉じて再度お試しください。';
      } else {
        message = `マイクの利用に失敗しました: ${e.message || e.name || 'unknown error'}`;
      }
      setUploadError(message);
      setTimeout(() => setUploadError(''), 8000);
    }
  };

  const handleVoiceSend = async (blob: Blob, mimeType: string) => {
    if (transceiver?.isProducing) transceiver.stopProducing();
    setRecorderStream(null);

    setIsSending(true);
    setUploadProgress(0);
    try {
      await api.uploadVoice(roomId, blob, (progress) => {
        setUploadProgress(progress);
      }, replyTo?.id);
      clearReplyTo();
      // Re-fetch messages and scroll to bottom
      await useMessageStore.getState().fetchMessages(roomId);
      window.dispatchEvent(new CustomEvent('scroll:bottom'));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setUploadError(''), 5000);
    } finally {
      setIsSending(false);
      setUploadProgress(null);
    }
  };

  const sendStamp = async (stamp: Stamp) => {
    try {
      await api.request('POST', `/rooms/${roomId}/messages`, {
        content: stamp.id,
        type: 'stamp',
      });
      clearReplyTo();
      await useMessageStore.getState().fetchMessages(roomId);
      window.dispatchEvent(new CustomEvent('scroll:bottom'));
    } catch (err) {
      console.error('Stamp send error:', err);
    }
  };

  return (
    <div className="message-input-container">
      {uploadError && (
        <div className="message-input-error">{uploadError}</div>
      )}
      {uploadProgress !== null && (
        <div className="message-input-progress">
          <div className="message-input-progress-bar" style={{ width: `${uploadProgress}%` }} />
          <span className="message-input-progress-text">アップロード中... {uploadProgress}%</span>
        </div>
      )}
      {replyTo && (
        <div className="message-input-reply">
          <span>{replyTo.sender_display_name}: {replyTo.content || replyTo.transcription?.formatted_text || replyTo.transcription?.raw_text || '(メディア)'}</span>
          <button onClick={clearReplyTo}>✕</button>
        </div>
      )}
      {showMention && (
        <MentionPicker
          members={mentionMembers}
          query={mentionQuery}
          onSelect={(name) => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            const cursorPos = textarea.selectionStart;
            const textBefore = text.slice(0, cursorPos);
            const textAfter = text.slice(cursorPos);
            const atIdx = textBefore.lastIndexOf('@');
            if (atIdx >= 0) {
              const newText = textBefore.slice(0, atIdx) + `@${name} ` + textAfter;
              setText(newText);
              setShowMention(false);
              // カーソルを挿入位置の後に移動
              setTimeout(() => {
                const newPos = atIdx + name.length + 2; // @ + name + space
                textarea.selectionStart = textarea.selectionEnd = newPos;
                textarea.focus();
              }, 0);
            }
          }}
          onClose={() => setShowMention(false)}
        />
      )}
      {showAgentPicker && (
        <MentionPicker
          members={agentTargets}
          query=""
          onSelect={insertAgentMention}
          onClose={() => setShowAgentPicker(false)}
        />
      )}
      <div className="message-input-row">
        <button
          className="message-input-attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending}
        >
          +
        </button>
        <button
          className="message-input-stamp"
          onClick={() => setShowStamps(!showStamps)}
          disabled={isSending}
          title="スタンプ"
        >
          😊
        </button>
        {assistantInRoom && (
          <button
            className="message-input-agent"
            onClick={onAgentButtonClick}
            disabled={isSending}
            title={agentTargets.length > 1 ? 'エージェントに聞く（宛先を選ぶ）' : `${assistantName} に聞く`}
          >
            🤖
          </button>
        )}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
          multiple
        />
        <textarea
          ref={textareaRef}
          className="message-input-text"
          value={text}
          onChange={(e) => {
            const value = e.target.value;
            setText(value);
            emitTyping();
            // @メンション検知
            const cursorPos = e.target.selectionStart;
            const textBefore = value.slice(0, cursorPos);
            const atMatch = textBefore.match(/@([^\s@]*)$/);
            if (atMatch) {
              if (!showMention) refreshCcProjects(); // #333: picker 開時に cc-project 一覧を最新化
              setMentionQuery(atMatch[1]);
              setShowMention(true);
            } else {
              setShowMention(false);
            }
          }}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={window.innerWidth >= 768 ? 'メッセージを入力（Ctrl+Enterで送信）' : 'メッセージを入力'}
          rows={1}
          disabled={isSending}
        />
        {text.trim() ? (
          <button
            className="message-input-send"
            onClick={handleSend}
            disabled={isSending}
          >
            ▶
          </button>
        ) : (
          <button
            className="message-input-mic-main"
            onClick={handleMicClick}
            disabled={isSending}
          >
            <Mic size={22} />
          </button>
        )}
      </div>

      {showStamps && (
        <StampPicker
          onSelect={sendStamp}
          onClose={() => setShowStamps(false)}
        />
      )}

      {recorderStream && (
        <VoiceRecorder
          stream={recorderStream}
          onSend={handleVoiceSend}
          onCancel={() => {
            if (transceiver?.isProducing) transceiver.stopProducing();
            recorderStream.getTracks().forEach((t) => t.stop());
            setRecorderStream(null);
          }}
          isTransceiverActive={transceiver?.isProducing}
        />
      )}
    </div>
  );
}

export default MessageInput;

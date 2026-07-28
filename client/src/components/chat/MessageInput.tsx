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
import { shouldOpenAgentPanel, shouldTriggerSlash, mergePromptInsertion } from '../../utils/agentPanelRules';
import VoiceRecorder from './VoiceRecorder';
import StampPicker from '../stamp/StampPicker';
import MentionPicker from './MentionPicker';
import type { MentionCandidate } from './MentionPicker';
import AgentPanel from './AgentPanel';
import type { AgentPanelMode } from './AgentPanel';
import type { PromptHistoryItem } from '../../services/api';
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
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      // 差し込んだ本文が複数行のことがあるので高さも合わせる (handleInput は user 入力でしか走らない)
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
    }, 0);
  }, []);

  // #354 🤖 パネル。null = 閉。'compose' = 宛先 + 最近の指示、'target-only' = 宛先のみ (入口B)
  const [agentPanel, setAgentPanel] = useState<AgentPanelMode | null>(null);
  // PC で `/` から開いたか (絞り込み文字列を textarea 側で持つため)
  const [slashMode, setSlashMode] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');

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

  // #354 このルームで自分が過去に送った「@宛先 + 本文」を再利用する。登録という手間を
  // 発生させないため、専用の登録先は持たず messages をそのまま読む。
  const [promptHistory, setPromptHistory] = useState<PromptHistoryItem[]>([]);
  const [targetCounts, setTargetCounts] = useState<Record<string, number>>({});
  const targetNames = useMemo(() => agentTargets.map(t => t.display_name), [agentTargets]);
  const refreshPromptHistory = useCallback(() => {
    if (!roomId || targetNames.length === 0) return;
    api.getPromptHistory(roomId, targetNames)
      .then(d => { setPromptHistory(d.items || []); setTargetCounts(d.target_counts || {}); })
      .catch(() => {});
  }, [roomId, targetNames]);
  // 開いた瞬間に「履歴があるか」で挙動を分けるので先読みしておく (ルーム切替時は一旦捨てる)
  useEffect(() => {
    setPromptHistory([]);
    setTargetCounts({});
    refreshPromptHistory();
  }, [refreshPromptHistory]);

  const closeAgentPanel = useCallback(() => {
    setAgentPanel(null);
    if (slashMode) setText('');  // `/` で開いたときは打った `/` ごと消す
    setSlashMode(false);
    setSlashQuery('');
    focusTextareaEnd();
  }, [slashMode, focusTextareaEnd]);

  const openAgentPanel = useCallback((mode: AgentPanelMode) => {
    setAgentPanel(mode);
    setShowMention(false);
    setShowStamps(false);
    if (mode === 'compose') refreshPromptHistory();  // 直前に送った指示も拾えるよう毎回最新化
    // スマホ: ソフトキーボードが出たままだと 2-3 件しか見えないので閉じる
    if (window.innerWidth < 768) textareaRef.current?.blur();
  }, [refreshPromptHistory]);

  // 宛先を選んだら composer に反映。入口B(pendingAgentBody あり)は本文込みで置換、
  // 入口A(ボタン)は先頭にメンションのみ prepend（本文はユーザーが続けて打つ）。
  const insertAgentMention = useCallback((name: string) => {
    setAgentPanel(null);
    if (pendingAgentBody != null) {
      setText(`@${name} ${pendingAgentBody}`);
      setPendingAgentBody(null);
    } else if (slashMode) {
      setText(`@${name} `);  // `/朝礼` 等の絞り込み文字列は宛先で置き換える
      setSlashMode(false);
      setSlashQuery('');
    } else {
      setText(prev => `@${name} ${prev}`);
    }
    focusTextareaEnd();
  }, [pendingAgentBody, slashMode, focusTextareaEnd]);

  // 過去の指示を挿入。表示されていた文字列 (宛先込みの全文) がそのまま入る。送信はしない。
  const insertPromptHistory = useCallback((content: string) => {
    setAgentPanel(null);
    setSlashMode(false);
    setSlashQuery('');
    setText(prev => mergePromptInsertion(prev, content, slashMode));
    focusTextareaEnd();
  }, [slashMode, focusTextareaEnd]);

  // 🤖ボタン: 選ぶものが無い(履歴0件かつ宛先1つ)なら従来どおり 1 タップで即挿入。
  // 使い込んで履歴が溜まるとパネルが現れる (初見のユーザーに選択肢を突きつけない)。
  const onAgentButtonClick = useCallback(() => {
    setPendingAgentBody(null);
    if (agentPanel) { closeAgentPanel(); return; }
    if (!shouldOpenAgentPanel({ historyCount: promptHistory.length, targetCount: agentTargets.length })) {
      if (assistantName) insertAgentMention(assistantName);
      return;
    }
    openAgentPanel('compose');
  }, [agentPanel, closeAgentPanel, promptHistory.length, agentTargets.length, assistantName, insertAgentMention, openAgentPanel]);

  // 入口B: コンテキストメニュー「エージェントに送る」が対象 message を積んだら消費する。
  // admin で宛先が複数なら picker を開き（本文は pendingAgentBody に退避）、単一なら直 prefill。
  useEffect(() => {
    if (!pendingAgentMessage) return;
    const msg = pendingAgentMessage;
    clearPendingAgentMessage();
    setReplyTo(msg);
    if (agentTargets.length > 1) {
      setPendingAgentBody(extractAgentBody(msg));
      // 本文は既にあるので、ここで見せるのは宛先だけ (履歴を出すと文脈が壊れる)
      openAgentPanel('target-only');
    } else if (assistantName) {
      setText(buildAgentPrefill({ assistantName, message: msg }));
      focusTextareaEnd();
    }
  }, [pendingAgentMessage, clearPendingAgentMessage, setReplyTo, agentTargets.length, assistantName, focusTextareaEnd, openAgentPanel]);

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
      // textarea の高さをリセット (ref 経由。querySelector は複数 room 表示等で誤爆源)
      const textarea = textareaRef.current;
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
      }, UPLOAD_DELAY);
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
      {agentPanel && (
        <AgentPanel
          targets={agentTargets}
          history={promptHistory}
          targetCounts={targetCounts}
          mode={agentPanel}
          query={slashMode ? slashQuery : ''}
          onSelectTarget={insertAgentMention}
          onSelectHistory={insertPromptHistory}
          onClose={closeAgentPanel}
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
            title={promptHistory.length > 0 || agentTargets.length > 1 ? 'エージェントに聞く（宛先・最近の指示）' : `${assistantName} に聞く`}
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
            // #354 `/` トリガ (PC のみ)。入力欄が空のときだけ開く — `docs/05` や `src/app.mts`
            // のようなパスを日常的に打つので、どこでも開くと誤爆が止まらない。
            if (slashMode) {
              if (value.startsWith('/')) setSlashQuery(value.slice(1));
              else { setAgentPanel(null); setSlashMode(false); setSlashQuery(''); }
            } else if (agentPanel === 'compose') {
              // ボタンで開いた後に打ち始めたら閉じる (改行の Enter を奪わない)。
              // 'target-only' は宛先待ちで pendingAgentBody を抱えているので閉じない。
              setAgentPanel(null);
            } else if (shouldTriggerSlash({
              prevText: text, nextText: value,
              isDesktop: window.innerWidth >= 768, assistantInRoom,
            })) {
              setSlashMode(true);
              setSlashQuery(value.slice(1));
              openAgentPanel('compose');
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

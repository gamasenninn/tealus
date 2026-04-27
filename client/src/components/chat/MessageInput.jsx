import { useState, useRef } from 'react';
import { getSocket } from '../../services/socket';
import { api } from '../../services/api';
import { useMessageStore } from '../../stores/messageStore';
import { useRoomStore } from '../../stores/roomStore';
import VoiceRecorder from './VoiceRecorder';
import StampPicker from '../stamp/StampPicker';
import MentionPicker from './MentionPicker';
import { FILE_SIZE_LIMITS, TYPING_DEBOUNCE, UPLOAD_DELAY } from '../../constants/ui';
import { Mic } from 'lucide-react';
import './MessageInput.css';

function MessageInput({ roomId }) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [recorderStream, setRecorderStream] = useState(null);
  const [showStamps, setShowStamps] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const typingTimerRef = useRef(null);
  const { replyTo, clearReplyTo } = useMessageStore();
  const { members } = useRoomStore();

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
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('message:send', {
          room_id: roomId,
          content,
          reply_to: replyTo?.id || null,
        });
      } else {
        await api.sendMessage(roomId, content, replyTo?.id);
      }
      setText('');
      // textarea の高さをリセット
      const textarea = document.querySelector('.message-input-text');
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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  // textarea 自動拡張
  const handleInput = (e) => {
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Client-side file size check
    const limits = FILE_SIZE_LIMITS;
    for (const file of files) {
      const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'default';
      const maxMB = limits[type];
      if (file.size > maxMB * 1024 * 1024) {
        setUploadError(`${file.name} のサイズが上限（${maxMB}MB）を超えています`);
        setTimeout(() => setUploadError(''), 5000);
        fileInputRef.current.value = '';
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
      setUploadError(err.message);
      setTimeout(() => setUploadError(''), 5000);
    } finally {
      setIsSending(false);
      setUploadProgress(null);
      fileInputRef.current.value = '';
    }
  };

  const handleMicClick = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setRecorderStream(stream);
    } catch (err) {
      setUploadError('マイクへのアクセスが許可されていません');
      setTimeout(() => setUploadError(''), 5000);
    }
  };

  const handleVoiceSend = async (blob, mimeType) => {
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
      setUploadError(err.message);
      setTimeout(() => setUploadError(''), 5000);
    } finally {
      setIsSending(false);
      setUploadProgress(null);
    }
  };

  const sendStamp = async (stamp) => {
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
          members={members}
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
              setMentionQuery(atMatch[1]);
              setShowMention(true);
            } else {
              setShowMention(false);
            }
          }}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
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
            recorderStream.getTracks().forEach((t) => t.stop());
            setRecorderStream(null);
          }}
        />
      )}
    </div>
  );
}

export default MessageInput;

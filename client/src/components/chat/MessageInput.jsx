import { useState, useRef } from 'react';
import { getSocket } from '../../services/socket';
import { api } from '../../services/api';
import { useMessageStore } from '../../stores/messageStore';
import './MessageInput.css';

function MessageInput({ roomId }) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef(null);
  const { replyTo, clearReplyTo } = useMessageStore();

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
      clearReplyTo();
    } catch (err) {
      console.error('Send error:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setIsSending(true);
    try {
      await api.uploadMedia(roomId, files);
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setIsSending(false);
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="message-input-container">
      {replyTo && (
        <div className="message-input-reply">
          <span>{replyTo.sender_display_name}: {replyTo.content || '(メディア)'}</span>
          <button onClick={clearReplyTo}>✕</button>
        </div>
      )}
      <div className="message-input-row">
        <button
          className="message-input-attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending}
        >
          +
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
          className="message-input-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力"
          rows={1}
          disabled={isSending}
        />
        <button
          className="message-input-send"
          onClick={handleSend}
          disabled={!text.trim() || isSending}
        >
          ▶
        </button>
      </div>
    </div>
  );
}

export default MessageInput;

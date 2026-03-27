import { useMessageStore } from '../../stores/messageStore';
import './MessageBubble.css';

function MessageBubble({ message, isOwn }) {
  const { setReplyTo } = useMessageStore();

  const formatTime = (dateStr) => {
    return new Date(dateStr).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderMedia = () => {
    if (!message.media || message.media.length === 0) return null;
    return message.media.map((m) => {
      if (m.mime_type.startsWith('image/')) {
        return (
          <img
            key={m.id}
            src={`/media/${m.thumbnail_path || m.file_path}`}
            alt={m.file_name}
            className="bubble-image"
            onClick={() => window.open(`/media/${m.file_path}`, '_blank')}
          />
        );
      }
      if (m.mime_type.startsWith('video/')) {
        return (
          <video key={m.id} src={`/media/${m.file_path}`} controls className="bubble-video" />
        );
      }
      return (
        <a key={m.id} href={`/media/${m.file_path}`} target="_blank" rel="noopener noreferrer" className="bubble-file">
          📎 {m.file_name}
        </a>
      );
    });
  };

  const renderReply = () => {
    if (!message.reply_to_message) return null;
    return (
      <div className="bubble-reply">
        <span className="bubble-reply-sender">{message.reply_to_message.sender_display_name}</span>
        <span className="bubble-reply-content">{message.reply_to_message.content || '(メディア)'}</span>
      </div>
    );
  };

  if (message.is_deleted) {
    return (
      <div className={`bubble-row ${isOwn ? 'own' : ''}`}>
        <div className="bubble deleted">メッセージが削除されました</div>
      </div>
    );
  }

  return (
    <div className={`bubble-row ${isOwn ? 'own' : ''}`}>
      {!isOwn && (
        <div className="bubble-sender-name">{message.sender_display_name}</div>
      )}
      <div className="bubble-content-row">
        {isOwn && (
          <div className="bubble-meta-left">
            {message.read_count > 0 && (
              <span className="bubble-read">既読{message.read_count}</span>
            )}
            <span className="bubble-time">{formatTime(message.created_at)}</span>
          </div>
        )}
        <div
          className={`bubble ${isOwn ? 'own' : 'other'}`}
          onDoubleClick={() => setReplyTo(message)}
        >
          {renderReply()}
          {message.content && <p className="bubble-text">{message.content}</p>}
          {renderMedia()}
        </div>
        {!isOwn && (
          <div className="bubble-meta-right">
            <span className="bubble-time">{formatTime(message.created_at)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;

import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useMessageStore } from '../../stores/messageStore';
import { api } from '../../services/api';
import ImageGrid from '../media/ImageGrid';
import ImageViewer from '../media/ImageViewer';
import VoiceBubble from './VoiceBubble';
import ContextMenu from './ContextMenu';
import LinkPreview from './LinkPreview';
import TagModal from '../tags/TagModal';
import { LONG_PRESS_TIMEOUT } from '../../constants/ui';
import { Copy, Reply, Tag, Pencil, ClipboardList, Trash2 } from 'lucide-react';
import './MessageBubble.css';

function MessageBubble({ message, isOwn, searchKeyword }) {
  const { roomId } = useParams();
  const { setReplyTo } = useMessageStore();
  const [viewerState, setViewerState] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [showTagModal, setShowTagModal] = useState(false);
  const [tags, setTags] = useState(message.tags || []);
  const longPressTimer = useRef(null);

  const highlightText = (text) => {
    if (!text || !searchKeyword) return text;
    const escaped = searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      i % 2 === 1 ? <mark key={i} className="search-highlight">{part}</mark> : part
    );
  };

  const formatTime = (dateStr) => {
    return new Date(dateStr).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleImageClick = (images, index) => {
    setViewerState({ images, index });
  };

  const renderMedia = () => {
    if (!message.media || message.media.length === 0) return null;
    return (
      <ImageGrid media={message.media} onImageClick={handleImageClick} />
    );
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

  // Context menu
  const showContextMenu = (x, y) => {
    const items = [];

    // Copy (text messages only)
    if (message.content && message.type === 'text') {
      items.push({
        icon: <Copy size={16} />,
        label: 'コピー',
        onClick: () => navigator.clipboard.writeText(message.content),
      });
    }

    // Reply
    items.push({
      icon: <Reply size={16} />,
      label: 'リプライ',
      onClick: () => setReplyTo(message),
    });

    // Tag
    items.push({
      icon: <Tag size={16} />,
      label: 'タグを追加',
      onClick: () => setShowTagModal(true),
    });

    // Copy voice transcription text
    const transText = message.transcription?.formatted_text || message.transcription?.raw_text;
    if (message.type === 'voice' && message.transcription?.status === 'done' && transText) {
      items.push({
        icon: <Copy size={16} />,
        label: '文字起こしをコピー',
        onClick: () => navigator.clipboard.writeText(transText),
      });
    }

    // Voice transcription actions (own voice messages only)
    if (isOwn && message.type === 'voice' && message.transcription?.status === 'done') {
      items.push({
        icon: <Pencil size={16} />,
        label: '文字起こしを編集',
        onClick: () => {
          window.dispatchEvent(new CustomEvent('voice:edit', { detail: { messageId: message.id } }));
        },
      });
      if (message.transcription?.version > 1) {
        items.push({
          icon: <ClipboardList size={16} />,
          label: '編集履歴',
          onClick: () => {
            window.dispatchEvent(new CustomEvent('voice:history', { detail: { messageId: message.id } }));
          },
        });
      }
    }

    // Delete (own messages only)
    if (isOwn) {
      items.push({
        icon: <Trash2 size={16} />,
        label: '削除',
        danger: true,
        onClick: async () => {
          if (confirm('このメッセージを削除しますか？')) {
            try {
              await api.deleteMessage(roomId, message.id);
              useMessageStore.getState().markDeleted(message.id);
            } catch (err) {
              console.error('Delete error:', err);
            }
          }
        },
      });
    }

    const onReaction = async (emoji) => {
      try {
        await api.toggleReaction(roomId, message.id, emoji);
      } catch (err) {
        console.error('Reaction error:', err);
      }
    };

    setContextMenu({ x, y, items, onReaction });
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  };

  const handleTouchStart = (e) => {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      showContextMenu(touch.clientX, touch.clientY);
    }, LONG_PRESS_TIMEOUT);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchMove = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  if (message.is_deleted) {
    return (
      <div className={`bubble-row ${isOwn ? 'own' : ''}`}>
        <div className="bubble deleted">メッセージが削除されました</div>
      </div>
    );
  }

  const hasMedia = message.media && message.media.length > 0;
  const hasText = message.content && message.content.trim() && message.type !== 'stamp';
  const isStamp = message.type === 'stamp';
  const isStampDeleted = isStamp && !message.stamp;

  return (
    <div className={`bubble-row ${isOwn ? 'own' : ''}`}>
      {!isOwn && (
        <div className="bubble-sender-info">
          {message.sender_avatar_url ? (
            <img src={`/media/${message.sender_avatar_url}`} alt="" className="bubble-avatar" />
          ) : (
            <span className="bubble-avatar-placeholder">{message.sender_display_name?.charAt(0)}</span>
          )}
          <span className="bubble-sender-name">{message.sender_display_name}</span>
        </div>
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
          className={`bubble ${isOwn ? 'own' : 'other'} ${hasMedia && !hasText ? 'media-only' : ''} ${isStamp && !isStampDeleted ? 'stamp-only' : ''}`}
          onDoubleClick={() => setReplyTo(message)}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
        >
          {message.type !== 'voice' && !isStamp && renderReply()}
          {isStampDeleted ? (
            <p className="bubble-text stamp-deleted">このスタンプは削除されました</p>
          ) : isStamp ? (
            <img src={`/media/${message.stamp.file_path}`} alt={message.stamp.label} className="bubble-stamp" />
          ) : (
            <>
              {hasText && <p className="bubble-text">{highlightText(message.content)}</p>}
              {message.type === 'voice' && <VoiceBubble message={message} media={message.media} transcription={message.transcription} isOwn={isOwn} replyMessage={message.reply_to_message} searchKeyword={searchKeyword} />}
              {message.type !== 'voice' && renderMedia()}
            </>
          )}
          {message.link_preview && <LinkPreview preview={message.link_preview} />}
        </div>
        {!isOwn && (
          <div className="bubble-meta-right">
            <span className="bubble-time">{formatTime(message.created_at)}</span>
          </div>
        )}
      </div>

      {tags.length > 0 && (
        <div className={`bubble-tags ${isOwn ? 'own' : ''}`}>
          {tags.map(tag => (
            <span key={tag.id} className="bubble-tag">#{tag.name}</span>
          ))}
        </div>
      )}

      {message.reactions && message.reactions.length > 0 && (
        <div className={`bubble-reactions ${isOwn ? 'own' : ''}`}>
          {message.reactions.map(r => (
            <span key={r.emoji} className={`reaction-badge ${r.me ? 'me' : ''}`}>
              {r.emoji}{r.count > 1 ? r.count : ''}
            </span>
          ))}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onReaction={(emoji) => { contextMenu.onReaction(emoji); setContextMenu(null); }}
        />
      )}

      {viewerState && (
        <ImageViewer
          images={viewerState.images}
          initialIndex={viewerState.index}
          onClose={() => setViewerState(null)}
        />
      )}

      {showTagModal && (
        <TagModal
          messageId={message.id}
          onClose={() => setShowTagModal(false)}
          onTagsChanged={async () => {
            try {
              const res = await api.getMessageTags(message.id);
              setTags(res.tags);
            } catch (err) {
              console.error('Tag refresh error:', err);
            }
          }}
        />
      )}
    </div>
  );
}

export default MessageBubble;

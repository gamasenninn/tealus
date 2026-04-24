import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useMessageStore } from '../../stores/messageStore';
import { useRoomStore } from '../../stores/roomStore';
import { api } from '../../services/api';
import ImageGrid from '../media/ImageGrid';
import ImageViewer from '../media/ImageViewer';
import VoiceBubble from './VoiceBubble';
import ContextMenu from './ContextMenu';
import LinkPreview from './LinkPreview';
import TagModal from '../tags/TagModal';
import TodoMenu from '../todo/TodoMenu';
import ForwardModal from './ForwardModal';
import { LONG_PRESS_TIMEOUT } from '../../constants/ui';
import { Megaphone, Volume2, Loader2 } from 'lucide-react';
import { diffChars } from 'diff';
import { buildContextMenuItems } from '../../hooks/useContextMenuItems.jsx';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './MessageBubble.css';

function MessageBubble({ message, isOwn, searchKeyword }) {
  const { roomId } = useParams();
  const { setReplyTo } = useMessageStore();
  const { currentRoom } = useRoomStore();
  const [viewerState, setViewerState] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showTodoMenu, setShowTodoMenu] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [tags, setTags] = useState(message.tags || []);
  const [isEditingMessage, setIsEditingMessage] = useState(false);
  const [editText, setEditText] = useState('');
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [editHistory, setEditHistory] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const ttsAudioRef = useRef(null);
  const TEXT_COLLAPSE_LENGTH = 300;
  const longPressTimer = useRef(null);
  const mdPreview = localStorage.getItem('mdPreview') !== 'off';

  // Markdown 内のテキストノードからメンションをハイライト
  const processMentions = (children) => {
    if (!children) return children;
    return Array.isArray(children)
      ? children.map((child, i) => {
          if (typeof child === 'string') {
            const mentionRegex = /@([\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u30fc\u30fb]+)/g;
            const parts = child.split(mentionRegex);
            if (parts.length <= 1) return child;
            return parts.map((part, j) =>
              j % 2 === 1 ? <span key={`${i}_${j}`} className="mention-highlight">@{part}</span> : part
            );
          }
          return child;
        })
      : typeof children === 'string'
        ? processMentions([children])
        : children;
  };

  const highlightText = (text) => {
    if (!text) return text;
    // @メンション + 検索キーワードのハイライト
    const mentionRegex = /@([\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u30fc\u30fb]+)/g;
    const parts = text.split(mentionRegex);
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        // メンション部分
        return <span key={`m${i}`} className="mention-highlight">@{part}</span>;
      }
      // 検索キーワードハイライト
      if (searchKeyword) {
        const escaped = searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const kwRegex = new RegExp(`(${escaped})`, 'gi');
        const kwParts = part.split(kwRegex);
        return kwParts.map((kw, j) =>
          j % 2 === 1 ? <mark key={`s${i}_${j}`} className="search-highlight">{kw}</mark> : kw
        );
      }
      return part;
    });
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

  // #155-personal: 読み上げ対象テキスト取得（text/voice 以外は null）
  const getTtsText = () => {
    if (message.is_deleted) return null;
    if (message.type === 'text') return message.content || null;
    if (message.type === 'voice') {
      const t = message.transcription;
      return t ? (t.formatted_text || t.raw_text || null) : null;
    }
    return null;
  };

  const handleTts = async () => {
    const text = getTtsText();
    if (!text || ttsLoading) return;

    // 既に再生中なら停止
    if (ttsAudioRef.current && !ttsAudioRef.current.paused) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
      return;
    }

    setTtsLoading(true);
    try {
      const blob = await api.synthesizeTts(text, roomId);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const volumePct = parseInt(localStorage.getItem('voiceVolume') || '80', 10);
      audio.volume = Math.max(0, Math.min(1, volumePct / 100));
      audio.onended = () => { URL.revokeObjectURL(url); ttsAudioRef.current = null; };
      audio.onerror = () => { URL.revokeObjectURL(url); ttsAudioRef.current = null; };
      ttsAudioRef.current = audio;
      await audio.play();
    } catch (err) {
      console.error('TTS error:', err);
      alert('読み上げに失敗しました: ' + (err.message || ''));
    } finally {
      setTtsLoading(false);
    }
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

  // #166 Forward: 転送元の表示
  const renderForwardHeader = () => {
    if (!message.forwarded_from) return null;
    const fm = message.forwarded_from_message;
    if (!fm) {
      // 元メッセージが削除されている場合
      return (
        <div className="bubble-forward-header">
          <span className="bubble-forward-label">📤 転送メッセージ</span>
          <span className="bubble-forward-deleted">（元メッセージは削除されました）</span>
        </div>
      );
    }
    return (
      <div className="bubble-forward-header">
        <span className="bubble-forward-label">📤 {fm.room_name} より転送</span>
        <span className="bubble-forward-sender">{fm.sender_display_name}</span>
      </div>
    );
  };

  // Context menu
  const showContextMenu = (x, y) => {
    const { items, onReaction } = buildContextMenuItems({
      message, isOwn, roomId, currentRoom,
      onEdit: () => { setEditText(message.content || ''); setIsEditingMessage(true); },
      onShowEditHistory: async () => {
        try {
          const data = await api.getMessageEdits(roomId, message.id);
          setEditHistory(data.edits);
          setShowEditHistory(true);
        } catch (err) { console.error(err); }
      },
      onReply: () => setReplyTo(message),
      onShowTagModal: () => setShowTagModal(true),
      onShowTodoMenu: () => setShowTodoMenu(true),
      onForward: () => setShowForwardModal(true),
    });
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
      {currentRoom?.is_announcement && message.is_published && (
        <div className="bubble-published"><Megaphone size={12} /> 公開中</div>
      )}
      <div className="bubble-content-row">
        {isOwn && (
          <div className="bubble-meta-left">
            {message.read_count > 0 && (
              <span className="bubble-read">既読{message.read_count}</span>
            )}
            <span className="bubble-time">{formatTime(message.created_at)}</span>
            {getTtsText() && (
              <button
                className={`bubble-tts-btn ${ttsLoading ? 'loading' : ''}`}
                onClick={handleTts}
                title="読み上げ"
                disabled={ttsLoading}
              >
                {ttsLoading ? <Loader2 size={14} className="spin" /> : <Volume2 size={14} />}
              </button>
            )}
          </div>
        )}
        <div
          className={`bubble ${isOwn ? 'own' : 'other'} ${hasMedia && !hasText ? 'media-only' : ''} ${isStamp && !isStampDeleted ? 'stamp-only' : ''} ${expanded ? 'expanded' : ''}`}
          onDoubleClick={() => setExpanded(prev => !prev)}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
        >
          {renderForwardHeader()}
          {message.type !== 'voice' && !isStamp && renderReply()}
          {isStampDeleted ? (
            <p className="bubble-text stamp-deleted">このスタンプは削除されました</p>
          ) : isStamp ? (
            <img src={`/media/${message.stamp.file_path}`} alt={message.stamp.label} className="bubble-stamp" />
          ) : (
            <>
              {hasText && (() => {
                const isLong = message.content && message.content.length > TEXT_COLLAPSE_LENGTH;
                const showFull = textExpanded || !isLong;
                const displayContent = showFull ? message.content : message.content.slice(0, TEXT_COLLAPSE_LENGTH) + '…';
                return (
                  <>
                    {mdPreview ? (
                      <div className={`bubble-text bubble-markdown ${!showFull ? 'collapsed' : ''}`}>
                        <Markdown remarkPlugins={[remarkGfm]} components={{
                          p: ({ children }) => <p>{processMentions(children)}</p>,
                          li: ({ children }) => <li>{processMentions(children)}</li>,
                        }}>{displayContent}</Markdown>
                        {message.is_edited && <span className="bubble-edited"> (編集済み)</span>}
                      </div>
                    ) : (
                      <p className={`bubble-text ${!showFull ? 'collapsed' : ''}`}>{highlightText(displayContent)}{message.is_edited && <span className="bubble-edited"> (編集済み)</span>}</p>
                    )}
                    {isLong && (
                      <button className="bubble-more-btn" onClick={(e) => { e.stopPropagation(); setTextExpanded(!textExpanded); }}>
                        {textExpanded ? '閉じる' : 'もっとみる'}
                      </button>
                    )}
                  </>
                );
              })()}
              {message.type === 'voice' && <VoiceBubble message={message} media={message.media} transcription={message.transcription} isOwn={isOwn} canEditTranscription={isOwn || currentRoom?.allow_member_transcription_edit} replyMessage={message.reply_to_message} searchKeyword={searchKeyword} />}
              {message.type !== 'voice' && renderMedia()}
            </>
          )}
          {message.link_preview && <LinkPreview preview={message.link_preview} />}
        </div>
        {!isOwn && (
          <div className="bubble-meta-right">
            <span className="bubble-time">{formatTime(message.created_at)}</span>
            {getTtsText() && (
              <button
                className={`bubble-tts-btn ${ttsLoading ? 'loading' : ''}`}
                onClick={handleTts}
                title="読み上げ"
                disabled={ttsLoading}
              >
                {ttsLoading ? <Loader2 size={14} className="spin" /> : <Volume2 size={14} />}
              </button>
            )}
          </div>
        )}
      </div>

      {tags.length > 0 && (
        <div className={`bubble-tags ${isOwn ? 'own' : ''}`}>
          {tags.map(tag => (
            tag.is_todo ? (
              <span
                key={tag.id}
                className={`bubble-tag todo ${tag.is_done ? 'done' : ''}`}
                onClick={async (e) => {
                  e.stopPropagation();
                  const newDone = !tag.is_done;
                  try {
                    await api.updateMessageTag(message.id, tag.id, { is_done: newDone });
                    const res = await api.getMessageTags(message.id);
                    setTags(res.tags);
                  } catch (err) { console.error(err); }
                }}
              >
                {tag.is_done ? '☑' : '☐'} {tag.name}
              </span>
            ) : (
              <span key={tag.id} className="bubble-tag">#{tag.name}</span>
            )
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

      {isEditingMessage && (
        <div className="modal-overlay" onClick={() => setIsEditingMessage(false)}>
          <div className="modal-box voice-edit-modal" onClick={e => e.stopPropagation()}>
            <h3>メッセージを編集</h3>
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={6}
              autoFocus
            />
            <div className="voice-edit-buttons">
              <button className="btn-cancel" onClick={() => setIsEditingMessage(false)}>キャンセル</button>
              <button className="btn-primary" onClick={async () => {
                try {
                  await api.editMessage(roomId, message.id, editText);
                  setIsEditingMessage(false);
                } catch (err) { console.error(err); }
              }} disabled={!editText.trim()}>確定</button>
            </div>
          </div>
        </div>
      )}

      {showEditHistory && (
        <div className="modal-overlay" onClick={() => setShowEditHistory(false)}>
          <div className="modal-box voice-history-modal" onClick={e => e.stopPropagation()}>
            <h3>編集履歴</h3>
            <div className="edit-history-list">
              {(() => {
                // 時系列順に並べる（ASC）
                const sorted = [...editHistory].reverse();
                // 各バージョン間の差分を表示
                const diffs = sorted.map((entry, i) => {
                  const prevText = entry.content;
                  const nextText = i < sorted.length - 1 ? sorted[i + 1].content : message.content;
                  const label = i < sorted.length - 1
                    ? `v${entry.version} → v${sorted[i + 1].version}`
                    : `v${entry.version} → 現在`;
                  const editor = i < sorted.length - 1 ? sorted[i + 1] : null;
                  return { entry, prevText, nextText, label, editor };
                });
                // 新しい変更が上にくるように逆順表示
                return diffs.reverse().map(({ entry, prevText, nextText, label, editor }) => (
                  <div key={entry.version} className="edit-history-item">
                    <div className="edit-history-header">
                      <span>{label}{editor?.edited_by_name ? ` — ${editor.edited_by_name}` : ''}</span>
                      <span>{editor ? new Date(editor.created_at).toLocaleString('ja-JP') : ''}</span>
                    </div>
                    <div className="edit-history-diff">
                      {diffChars(prevText, nextText).map((part, j) => (
                        <span key={j} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}>{part.value}</span>
                      ))}
                    </div>
                  </div>
                ));
              })()}
              <div className="edit-history-item">
                <div className="edit-history-header"><span>原文</span></div>
                <p>{editHistory.length > 0 ? editHistory[editHistory.length - 1].content : message.content}</p>
              </div>
            </div>
            <button className="btn-cancel" style={{ width: '100%', marginTop: '12px' }} onClick={() => setShowEditHistory(false)}>閉じる</button>
          </div>
        </div>
      )}

      {viewerState && (
        <ImageViewer
          images={viewerState.images}
          initialIndex={viewerState.index}
          onClose={() => setViewerState(null)}
        />
      )}

      {showForwardModal && (
        <ForwardModal
          message={message}
          onClose={() => setShowForwardModal(false)}
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
      {showTodoMenu && (
        <TodoMenu
          messageId={message.id}
          roomId={roomId}
          onClose={() => setShowTodoMenu(false)}
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

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useRoomStore } from '../../stores/roomStore';
import { useMessageStore } from '../../stores/messageStore';
import { getSocket } from '../../services/socket';
import { api } from '../../services/api';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import MemberList from './MemberList';
import DateSeparator from './DateSeparator';
import './ChatRoom.css';

function ChatRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentRoom, members, selectRoom, clearCurrentRoom } = useRoomStore();
  const { messages, fetchMessages, addMessage, clearMessages, loadMore, hasMore } = useMessageStore();
  const [showMembers, setShowMembers] = useState(false);
  const [stickyDate, setStickyDate] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    selectRoom(roomId);
    fetchMessages(roomId);
    isInitialLoad.current = true;

    const socket = getSocket();
    if (socket) {
      socket.emit('room:join', roomId);

      socket.on('message:new', (msg) => {
        addMessage(msg);
        // Mark as read and play notification if from someone else
        if (msg.sender_id !== user.id) {
          api.markRead(roomId, [msg.id]).catch(() => {});
          socket.emit('message:read', { room_id: roomId, message_ids: [msg.id] });
          // Notification sound
          if (localStorage.getItem('notificationSound') !== 'off') {
            new Audio('/notification.wav').play().catch(() => {});
          }
        }
      });

      socket.on('message:read', (data) => {
        const { read_counts } = data;
        if (read_counts) {
          Object.entries(read_counts).forEach(([id, count]) => {
            useMessageStore.getState().updateReadCount(id, count);
          });
        }
      });

      socket.on('voice:status', (data) => {
        useMessageStore.getState().updateTranscription(data.message_id, { status: data.status });
      });

      socket.on('voice:transcription', (data) => {
        useMessageStore.getState().updateTranscription(data.message_id, {
          status: data.status,
          raw_text: data.raw_text,
          formatted_text: data.formatted_text,
        });
      });

      socket.on('message:deleted', (data) => {
        useMessageStore.getState().markDeleted(data.message_id);
      });

      socket.on('typing:start', (data) => {
        setTypingUsers(prev => ({ ...prev, [data.user_id]: data.display_name }));
      });

      socket.on('typing:stop', (data) => {
        setTypingUsers(prev => {
          const next = { ...prev };
          delete next[data.user_id];
          return next;
        });
      });
    }

    return () => {
      clearCurrentRoom();
      clearMessages();
      if (socket) {
        socket.emit('room:leave', roomId);
        socket.off('message:new');
        socket.off('message:read');
        socket.off('voice:status');
        socket.off('voice:transcription');
        socket.off('message:deleted');
        socket.off('typing:start');
        socket.off('typing:stop');
      }
    };
  }, [roomId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length === 0) return;

    if (isInitialLoad.current) {
      // Initial load or reload — always scroll to bottom
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView();
        markVisibleAsRead();
      }, 50);
      isInitialLoad.current = false;
    } else {
      // New message arrived — scroll only if already near bottom
      const container = messagesContainerRef.current;
      if (container) {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (isNearBottom) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          markVisibleAsRead();
        }
      }
    }
  }, [messages.length]);

  const markVisibleAsRead = useCallback(() => {
    const unreadIds = messages
      .filter((m) => m.sender_id !== user.id)
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      api.markRead(roomId, unreadIds).catch(() => {});
      const socket = getSocket();
      if (socket) {
        socket.emit('message:read', { room_id: roomId, message_ids: unreadIds });
      }
    }
  }, [messages, roomId, user]);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (container.scrollTop < 50 && hasMore) {
      const prevScrollHeight = container.scrollHeight;
      loadMore(roomId).then(() => {
        requestAnimationFrame(() => {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = newScrollHeight - prevScrollHeight;
        });
      });
    }

    // Update sticky date based on first visible message
    const separators = container.querySelectorAll('[data-date]');
    let currentDate = null;
    for (const sep of separators) {
      const rect = sep.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (rect.top <= containerRect.top + 40) {
        currentDate = sep.getAttribute('data-date');
      } else {
        break;
      }
    }
    setStickyDate(currentDate);
  };

  const getRoomTitle = () => {
    if (!currentRoom) return '';
    if (currentRoom.type === 'group') return currentRoom.name;
    const partner = members.find((m) => m.user_id !== user.id);
    return partner?.display_name || 'トーク';
  };

  const getMemberCount = () => {
    if (!currentRoom || currentRoom.type !== 'group') return null;
    return members.length;
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <button className="chat-back" onClick={() => navigate('/')}>←</button>
        <div className="chat-header-info">
          <span className="chat-header-title">{getRoomTitle()}</span>
          {getMemberCount() && (
            <span className="chat-header-count">{getMemberCount()}人</span>
          )}
        </div>
        {currentRoom?.type === 'group' && (
          <button className="chat-menu" onClick={() => setShowMembers(true)}>≡</button>
        )}
      </header>

      <div
        className="chat-messages"
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {stickyDate && (
          <div className="sticky-date">
            <DateSeparator date={stickyDate} />
          </div>
        )}
        {messages.map((msg, i) => {
          const prevMsg = messages[i - 1];
          const showDate = !prevMsg ||
            new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();
          return (
            <div key={msg.id} data-date={showDate ? msg.created_at : undefined}>
              {showDate && <DateSeparator date={msg.created_at} hidden={stickyDate && new Date(msg.created_at).toDateString() === new Date(stickyDate).toDateString()} />}
              <MessageBubble message={msg} isOwn={msg.sender_id === user.id} />
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {Object.keys(typingUsers).length > 0 && (
        <div className="typing-indicator">
          {Object.values(typingUsers).join(', ')}が入力中...
        </div>
      )}

      <MessageInput roomId={roomId} />

      {showMembers && (
        <MemberList roomId={roomId} onClose={() => setShowMembers(false)} />
      )}
    </div>
  );
}

export default ChatRoom;

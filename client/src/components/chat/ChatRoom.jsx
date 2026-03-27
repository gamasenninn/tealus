import { useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useRoomStore } from '../../stores/roomStore';
import { useMessageStore } from '../../stores/messageStore';
import { getSocket } from '../../services/socket';
import { api } from '../../services/api';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import './ChatRoom.css';

function ChatRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentRoom, members, selectRoom, clearCurrentRoom } = useRoomStore();
  const { messages, fetchMessages, addMessage, clearMessages, loadMore, hasMore } = useMessageStore();
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
      });

      socket.on('message:read', (data) => {
        // Could update read counts here
      });
    }

    return () => {
      clearCurrentRoom();
      clearMessages();
      if (socket) {
        socket.emit('room:leave', roomId);
        socket.off('message:new');
        socket.off('message:read');
      }
    };
  }, [roomId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isInitialLoad.current && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView();
      isInitialLoad.current = false;
      // Mark visible messages as read
      markVisibleAsRead();
    } else if (messages.length > 0) {
      const container = messagesContainerRef.current;
      if (container) {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (isNearBottom) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          markVisibleAsRead();
        }
      }
    }
  }, [messages]);

  const markVisibleAsRead = useCallback(() => {
    const unreadIds = messages
      .filter((m) => m.sender_id !== user.id)
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      api.markRead(roomId, unreadIds).catch(() => {});
    }
  }, [messages, roomId, user]);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (container && container.scrollTop === 0 && hasMore) {
      loadMore(roomId);
    }
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
      </header>

      <div
        className="chat-messages"
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOwn={msg.sender_id === user.id}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <MessageInput roomId={roomId} />
    </div>
  );
}

export default ChatRoom;

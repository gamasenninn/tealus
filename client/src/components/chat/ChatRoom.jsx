import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useRoomStore } from '../../stores/roomStore';
import { useMessageStore } from '../../stores/messageStore';
import { useSocketSync } from '../../hooks/useSocketSync';
import { useMessageScroll } from '../../hooks/useMessageScroll';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import MemberList from './MemberList';
import DateSeparator from './DateSeparator';
import './ChatRoom.css';

function ChatRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentRoom, members, error: roomError } = useRoomStore();
  const { messages, error: messageError } = useMessageStore();
  const [showMembers, setShowMembers] = useState(false);

  // Custom hooks
  const { typingUsers } = useSocketSync(roomId);
  const { messagesEndRef, messagesContainerRef, stickyDate, handleScroll } = useMessageScroll(roomId);
  const { onlineUsers } = useOnlineStatus();

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

  const getPartnerOnline = () => {
    if (!currentRoom || currentRoom.type !== 'direct') return false;
    const partner = members.find(m => m.user_id !== user.id);
    return partner ? onlineUsers.has(partner.user_id) : false;
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
          {getPartnerOnline() && (
            <span className="chat-header-online">オンライン</span>
          )}
        </div>
        {currentRoom?.type === 'group' && (
          <button className="chat-menu" onClick={() => setShowMembers(true)}>≡</button>
        )}
      </header>

      {(roomError || messageError) && (
        <div className="chat-error">{roomError || messageError}</div>
      )}

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

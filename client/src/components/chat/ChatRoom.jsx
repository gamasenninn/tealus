import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useRoomStore } from '../../stores/roomStore';
import { useMessageStore } from '../../stores/messageStore';
import { useSocketSync } from '../../hooks/useSocketSync';
import { useMessageScroll } from '../../hooks/useMessageScroll';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { getSocket } from '../../services/socket';
import { useVoiceContinuousPlay } from '../../hooks/useVoiceContinuousPlay';
import { useAppPanel } from '../../hooks/useAppPanel';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import MemberList from './MemberList';
import DateSeparator from './DateSeparator';
import UnreadSeparator from './UnreadSeparator';
import { ArrowLeft, Search, Image, Smartphone, Phone } from 'lucide-react';
import './ChatRoom.css';

function ChatRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const { currentRoom, members, lastReadMessageId, error: roomError } = useRoomStore();
  const { messages, error: messageError } = useMessageStore();
  const [showMembers, setShowMembers] = useState(false);
  const { showAppPanel, setShowAppPanel, activeAppIndex, setActiveAppIndex, appUrls } = useAppPanel(currentRoom);
  useVoiceContinuousPlay(messages);

  // Search params
  const targetMsgId = searchParams.get('msg');
  const searchKeyword = searchParams.get('q');
  const isEmbed = searchParams.get('embed') === 'true';
  useEffect(() => {
    if (targetMsgId && messages.length > 0) {
      setTimeout(() => {
        const el = document.querySelector(`[data-msg-id="${targetMsgId}"]`);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          el.classList.add('highlight-msg');
          setTimeout(() => el.classList.remove('highlight-msg'), 3000);
        }
      }, 200);
    }
  }, [targetMsgId, messages.length]);

  // Custom hooks
  const { typingUsers, agentStatus } = useSocketSync(roomId, targetMsgId);
  const { messagesEndRef, messagesContainerRef, loadMoreSentinelRef, handleScroll } = useMessageScroll(roomId);
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
    <div className={`chat-container ${isEmbed ? 'embed' : ''}`}>
      <header className="chat-header">
        {!isEmbed && <button className="chat-back" onClick={() => navigate(-1)}><ArrowLeft size={22} /></button>}
        <div className="chat-header-info">
          <span className="chat-header-title">{getRoomTitle()}</span>
          {getMemberCount() && (
            <span className="chat-header-count">{getMemberCount()}人</span>
          )}
          {getPartnerOnline() && (
            <span className="chat-header-online">オンライン</span>
          )}
        </div>
        <button className="chat-header-btn" onClick={() => {
          const socket = getSocket();
          if (socket) {
            socket.emit('call:start', { roomId });
            // 自分も通話画面を開く — App.jsx の useCallNotification 経由
            window.dispatchEvent(new CustomEvent('call:start', { detail: { roomId } }));
          }
        }} title="通話"><Phone size={18} /></button>
        {appUrls.length > 0 && (
          <button className={`chat-header-btn ${showAppPanel ? 'active' : ''}`} onClick={() => setShowAppPanel(!showAppPanel)} title="アプリ"><Smartphone size={18} /></button>
        )}
        <button className="chat-header-btn" onClick={() => navigate(`/rooms/${roomId}/gallery`)} title="ファイル"><Image size={18} /></button>
        <button className="chat-header-btn" onClick={() => navigate(`/search?room_id=${roomId}`)}><Search size={18} /></button>
        {currentRoom?.type === 'group' && (
          <button className="chat-header-btn" onClick={() => setShowMembers(true)}>≡</button>
        )}
      </header>

      {(roomError || messageError) && (
        <div className="error-bar">{roomError || messageError}</div>
      )}

      <div
        className="chat-messages"
        ref={messagesContainerRef}
        onScroll={handleScroll}
        style={showAppPanel && appUrls.length > 0 ? { flex: 100 - (appUrls[activeAppIndex]?.ratio || 50) } : undefined}
      >
          <div ref={loadMoreSentinelRef} style={{ height: 1 }} />
        {messages.map((msg, i) => {
          const prevMsg = messages[i - 1];
          const showDate = !prevMsg ||
            new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();
          const showUnread = lastReadMessageId && prevMsg && prevMsg.id === lastReadMessageId && msg.sender_id !== user.id;
          return (
            <div key={msg.id} data-date={showDate ? msg.created_at : undefined} data-msg-id={msg.id}>
              {showDate && <DateSeparator date={msg.created_at} />}
              {showUnread && <UnreadSeparator />}
              <MessageBubble message={msg} isOwn={msg.sender_id === user.id} searchKeyword={searchKeyword} />
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {(Object.keys(typingUsers).length > 0 || agentStatus) && (
        <div className="typing-indicator">
          {agentStatus
            ? `${agentStatus.display_name}: ${agentStatus.message || agentStatus.status}`
            : `${Object.values(typingUsers).join(', ')}が入力中...`}
        </div>
      )}

      {showAppPanel && appUrls.length > 0 && (
        <div className="app-panel" style={{ flex: appUrls[activeAppIndex]?.ratio || 50 }}>
          {appUrls.length > 1 && (
            <div className="app-panel-tabs">
              {appUrls.map((app, i) => (
                <button
                  key={i}
                  className={`app-panel-tab ${activeAppIndex === i ? 'active' : ''}`}
                  onClick={() => setActiveAppIndex(i)}
                >
                  {app.title}
                </button>
              ))}
            </div>
          )}
          <iframe
            className="app-panel-iframe"
            src={appUrls[activeAppIndex]?.url}
            title={appUrls[activeAppIndex]?.title}
            allow="microphone; camera; autoplay; fullscreen"
          />
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

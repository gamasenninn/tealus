import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
import UnreadSeparator from './UnreadSeparator';
import { ArrowLeft, Search, Image, Smartphone } from 'lucide-react';
import './ChatRoom.css';

function ChatRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const { currentRoom, members, lastReadMessageId, error: roomError } = useRoomStore();
  const { messages, error: messageError } = useMessageStore();
  const [showMembers, setShowMembers] = useState(false);
  const [showAppPanel, setShowAppPanel] = useState(false);
  const [activeAppIndex, setActiveAppIndex] = useState(0);
  const appUrls = currentRoom?.app_urls || [];

  // Auto-open app panel
  useEffect(() => {
    if (appUrls.length > 0) {
      const autoIdx = appUrls.findIndex(a => a.auto_open);
      if (autoIdx >= 0) {
        setShowAppPanel(true);
        setActiveAppIndex(autoIdx);
      }
    }
  }, [currentRoom?.id]);

  // Voice continuous playback + Wake Lock
  useEffect(() => {
    let wakeLock = null;

    const acquireWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && !wakeLock) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
      } catch (e) { /* Wake Lock not supported or failed */ }
    };

    const releaseWakeLock = () => {
      if (wakeLock) { wakeLock.release(); wakeLock = null; }
    };

    const handleVoiceEnded = (e) => {
      const endedId = e.detail.messageId;
      const voiceMessages = messages.filter(m => m.type === 'voice');
      const currentIdx = voiceMessages.findIndex(m => m.id === endedId);
      if (currentIdx >= 0 && currentIdx < voiceMessages.length - 1) {
        const nextMsg = voiceMessages[currentIdx + 1];
        acquireWakeLock();
        window.dispatchEvent(new CustomEvent('voice:play', { detail: { messageId: nextMsg.id } }));
        setTimeout(() => {
          const el = document.querySelector(`[data-msg-id="${nextMsg.id}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      } else {
        // 最後のメッセージ → Wake Lock解除
        releaseWakeLock();
      }
    };

    const handleStopContinuous = () => {
      releaseWakeLock();
    };

    // タブが再表示された時にWake Lockを再取得
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && wakeLock === null) {
        // 再生中ならWake Lock再取得（audio要素の再生状態は各VoiceBubbleが管理）
      }
    };

    const handleVoiceStarted = () => { acquireWakeLock(); };

    window.addEventListener('voice:ended', handleVoiceEnded);
    window.addEventListener('voice:started', handleVoiceStarted);
    window.addEventListener('voice:stop-continuous', handleStopContinuous);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('voice:ended', handleVoiceEnded);
      window.removeEventListener('voice:started', handleVoiceStarted);
      window.removeEventListener('voice:stop-continuous', handleStopContinuous);
      document.removeEventListener('visibilitychange', handleVisibility);
      releaseWakeLock();
    };
  }, [messages]);

  // Search params
  const targetMsgId = searchParams.get('msg');
  const searchKeyword = searchParams.get('q');
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
  const { typingUsers } = useSocketSync(roomId, targetMsgId);
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
        <button className="chat-back" onClick={() => navigate(-1)}><ArrowLeft size={22} /></button>
        <div className="chat-header-info">
          <span className="chat-header-title">{getRoomTitle()}</span>
          {getMemberCount() && (
            <span className="chat-header-count">{getMemberCount()}人</span>
          )}
          {getPartnerOnline() && (
            <span className="chat-header-online">オンライン</span>
          )}
        </div>
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
        {stickyDate && (
          <div className="sticky-date">
            <DateSeparator date={stickyDate} />
          </div>
        )}
        {messages.map((msg, i) => {
          const prevMsg = messages[i - 1];
          const showDate = !prevMsg ||
            new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();
          const showUnread = lastReadMessageId && prevMsg && prevMsg.id === lastReadMessageId && msg.sender_id !== user.id;
          return (
            <div key={msg.id} data-date={showDate ? msg.created_at : undefined} data-msg-id={msg.id}>
              {showDate && <DateSeparator date={msg.created_at} hidden={stickyDate && new Date(msg.created_at).toDateString() === new Date(stickyDate).toDateString()} />}
              {showUnread && <UnreadSeparator />}
              <MessageBubble message={msg} isOwn={msg.sender_id === user.id} searchKeyword={searchKeyword} />
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

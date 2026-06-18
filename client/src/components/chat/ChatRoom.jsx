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
import { ArrowLeft, Search, Image, Smartphone, Phone, PhoneCall, Radio } from 'lucide-react';
import CallConfirmModal from '../call/CallConfirmModal';
import { useTransceiver } from '../../hooks/useTransceiver';
import TransceiverErrorBoundary from './TransceiverErrorBoundary';
import MessageErrorBoundary from './MessageErrorBoundary';
import DeepCancelButton from './DeepCancelButton';
import { useCapabilityStore } from '../../stores/capabilityStore';
import './ChatRoom.css';

function ChatRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const { currentRoom, members, lastReadMessageId, error: roomError } = useRoomStore();
  const { messages, error: messageError } = useMessageStore();
  const [showMembers, setShowMembers] = useState(false);
  const [showCallConfirm, setShowCallConfirm] = useState(false);
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

  // #256: reply 引用 tap → 元 message へ scroll + highlight
  // CustomEvent 'message:scroll-to' を MessageBubble / VoiceBubble の bubble-reply onClick から dispatch
  // 現 viewport に居れば即 scroll、不在なら fetchMessages around で再 load してから scroll
  useEffect(() => {
    const tryScroll = (id) => {
      const el = document.querySelector(`[data-msg-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('highlight-msg');
        setTimeout(() => el.classList.remove('highlight-msg'), 3000);
        return true;
      }
      return false;
    };
    const handler = async (e) => {
      const { id } = e.detail || {};
      if (!id) return;
      if (tryScroll(id)) return;
      // 未 load: around fetch で再 render → 再 query
      await useMessageStore.getState().fetchMessages(roomId, id);
      setTimeout(() => tryScroll(id), 200);
    };
    window.addEventListener('message:scroll-to', handler);
    return () => window.removeEventListener('message:scroll-to', handler);
  }, [roomId]);

  // Custom hooks
  const { typingUsers, agentStatus } = useSocketSync(roomId, targetMsgId);
  const { messagesEndRef, messagesContainerRef, loadMoreSentinelRef, handleScroll } = useMessageScroll(roomId);
  const { onlineUsers } = useOnlineStatus();
  const transceiver = useTransceiver(roomId);
  const realtimeVoiceAvailable = useCapabilityStore((s) => s.realtimeVoiceAvailable);
  const [callStatus, setCallStatus] = useState(null); // { state: 'waiting'|'active', count }

  // 通話ステータスのリスナー
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // 初回取得
    socket.emit('call:getStatus', { roomId });

    const handleStatus = (data) => {
      if (data.roomId !== roomId) return;
      setCallStatus(data.active ? { state: data.state, count: data.count } : null);
    };
    socket.on('call:status', handleStatus);
    return () => socket.off('call:status', handleStatus);
  }, [roomId]);

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
        {!isEmbed && <button className="chat-back" onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/talk')}><ArrowLeft size={22} /></button>}
        <div className="chat-header-info">
          <span className="chat-header-title">{getRoomTitle()}</span>
          {getMemberCount() && (
            <span className="chat-header-count">{getMemberCount()}人</span>
          )}
          {getPartnerOnline() && (
            <span className="chat-header-online">オンライン</span>
          )}
        </div>
        {realtimeVoiceAvailable && !callStatus && (
          <button
            className={`chat-header-btn ${transceiver.isConnected ? 'transceiver-active' : ''}`}
            onClick={() => transceiver.isConnected ? transceiver.disconnect() : transceiver.connect()}
            title={transceiver.isConnected ? 'トランシーバー切断' : 'トランシーバー接続'}
          >
            <Radio size={16} />
          </button>
        )}
        {realtimeVoiceAvailable && (callStatus ? (
          <button className="chat-header-btn call-status-btn" onClick={() => setShowCallConfirm(true)} title="通話に参加">
            <PhoneCall size={16} />
            <span className="call-status-label">{callStatus.state === 'waiting' ? '待機中' : '通話中'}</span>
          </button>
        ) : (
          <button className="chat-header-btn" onClick={() => setShowCallConfirm(true)} title="通話"><Phone size={18} /></button>
        ))}
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
              <MessageErrorBoundary messageId={msg.id}>
                <MessageBubble message={msg} isOwn={msg.sender_id === user.id} searchKeyword={searchKeyword} />
              </MessageErrorBoundary>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <TransceiverErrorBoundary>
        {transceiver.isConnected && transceiver.remoteSpeaker && (
          <div className="transceiver-indicator">
            🔊 {'█'.repeat(Math.round(transceiver.remoteAudioLevel * 10))}{'░'.repeat(10 - Math.round(transceiver.remoteAudioLevel * 10))} {transceiver.remoteSpeaker}
          </div>
        )}
        {transceiver.audioBlocked && (
          <button
            type="button"
            className="audio-unlock-banner"
            onClick={() => transceiver.unlockAudio()}
            title="ブラウザの autoplay 制限により音声再生が止められています。クリックで有効化"
          >
            🔊 音声を有効化（ブラウザ制限解除）
          </button>
        )}
      </TransceiverErrorBoundary>

      {(Object.keys(typingUsers).length > 0 || agentStatus) && (
        <div className="typing-indicator">
          {agentStatus
            ? `${agentStatus.display_name}: ${agentStatus.message || agentStatus.status}`
            : `${Object.values(typingUsers).join(', ')}が入力中...`}
          {agentStatus?.status === 'analyzing' && <DeepCancelButton roomId={roomId} />}
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

      <MessageInput roomId={roomId} transceiver={transceiver} />

      {showMembers && (
        <MemberList roomId={roomId} onClose={() => setShowMembers(false)} />
      )}
      {showCallConfirm && (
        <CallConfirmModal
          onConfirm={({ video, audio }) => {
            setShowCallConfirm(false);
            const socket = getSocket();
            if (socket) {
              socket.emit('call:start', { roomId });
              window.dispatchEvent(new CustomEvent('call:start', { detail: { roomId, video, audio } }));
            }
          }}
          onCancel={() => setShowCallConfirm(false)}
        />
      )}
    </div>
  );
}

export default ChatRoom;

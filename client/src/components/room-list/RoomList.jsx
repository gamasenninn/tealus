import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useRoomStore } from '../../stores/roomStore';
import { getSocket } from '../../services/socket';
import { api } from '../../services/api';
import CreateRoom from './CreateRoom';
import './RoomList.css';

function RoomList() {
  const { user, logout } = useAuthStore();
  const { rooms, fetchRooms, error } = useRoomStore();
  const [showCreate, setShowCreate] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    fetchRooms();
    api.getOnlineUsers().then(data => setOnlineUsers(new Set(data.online))).catch(() => {});
  }, [fetchRooms]);

  // Join all rooms for real-time updates on room list
  useEffect(() => {
    const socket = getSocket();
    if (!socket || rooms.length === 0) return;

    // Join all rooms so we receive message:new events
    rooms.forEach((room) => {
      socket.emit('room:join', room.id);
    });

    const handleNewMessage = (msg) => {
      fetchRooms();
      if (msg.sender_id !== user.id && localStorage.getItem('notificationSound') !== 'off') {
        new Audio('/notification.wav').play().catch(() => {});
      }
    };

    socket.on('message:new', handleNewMessage);

    const handleOnline = (data) => {
      setOnlineUsers(prev => new Set([...prev, data.user_id]));
    };
    const handleOffline = (data) => {
      setOnlineUsers(prev => { const next = new Set(prev); next.delete(data.user_id); return next; });
    };
    socket.on('user:online', handleOnline);
    socket.on('user:offline', handleOffline);

    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('user:online', handleOnline);
      socket.off('user:offline', handleOffline);
      // Leave all rooms when leaving room list
      rooms.forEach((room) => {
        socket.emit('room:leave', room.id);
      });
    };
  }, [rooms.length, fetchRooms]);

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  };

  const getPreview = (room) => {
    if (!room.last_message_content && room.last_message_type) {
      const typeLabels = { image: '画像', video: '動画', file: 'ファイル' };
      return typeLabels[room.last_message_type] || '';
    }
    return room.last_message_content || '';
  };

  const getRoomDisplayName = (room) => {
    if (room.type === 'group') return `${room.name}（${room.member_count}）`;
    return room.partner_display_name || 'ダイレクトメッセージ';
  };

  return (
    <div className="room-list-container">
      <header className="room-list-header">
        <img src="/logo.png" alt="Linny" className="room-list-logo" />
        <h1>トーク</h1>
        <div className="room-list-header-actions">
          {user?.role === 'admin' && (
            <button className="icon-button" onClick={() => navigate('/admin')} title="管理">
              ⚙
            </button>
          )}
          <button className="icon-button" onClick={() => setShowCreate(true)} title="新規作成">
            +
          </button>
          <button className="icon-button" onClick={logout} title="ログアウト">
            ↩
          </button>
        </div>
      </header>

      {error && <div className="error-bar">{error}</div>}
      <div className="room-list-user-info" onClick={() => navigate('/profile')} style={{ cursor: 'pointer' }}>
        {user?.avatar_url ? (
          <img src={`/media/${user.avatar_url}`} alt="" className="room-list-avatar" />
        ) : (
          <span className="room-list-avatar-placeholder">{user?.display_name?.charAt(0)}</span>
        )}
        {user?.display_name}（{user?.employee_id}）
      </div>

      <div className="room-list">
        {rooms.length === 0 && (
          <div className="room-list-empty">
            トークがありません。<br />
            +ボタンから新しいトークを始めましょう。
          </div>
        )}
        {rooms.map((room) => (
          <div
            key={room.id}
            className="room-item"
            onClick={() => navigate(`/rooms/${room.id}`)}
          >
            <div className="room-avatar">
              {room.type === 'direct' && room.partner_avatar_url ? (
                <img src={`/media/${room.partner_avatar_url}`} alt="" className="room-avatar-img" />
              ) : room.type === 'group' && room.icon_url ? (
                <img src={`/media/${room.icon_url}`} alt="" className="room-avatar-img" />
              ) : (
                room.type === 'group' ? '👥' : '👤'
              )}
              {room.type === 'direct' && room.partner_id && onlineUsers.has(room.partner_id) && (
                <span className="online-dot" />
              )}
            </div>
            <div className="room-info">
              <div className="room-top-row">
                <span className="room-name">{getRoomDisplayName(room)}</span>
                <span className="room-time">{formatTime(room.last_message_at)}</span>
              </div>
              <div className="room-bottom-row">
                <span className="room-preview">{getPreview(room)}</span>
                {room.unread_count > 0 && (
                  <span className="room-unread">{room.unread_count}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showCreate && <CreateRoom onClose={() => setShowCreate(false)} />}
    </div>
  );
}

export default RoomList;

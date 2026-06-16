import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useRoomStore } from '../../stores/roomStore';
import { useConfirm } from '../../stores/confirmStore';
import { getSocket } from '../../services/socket';
import { api } from '../../services/api';
import CreateRoom from './CreateRoom';
import { LONG_PRESS_TIMEOUT } from '../../constants/ui';
import { canCreateRoom } from '../../utils/permissions';
import { Search, Plus, Columns } from 'lucide-react';
import BottomNav from '../common/BottomNav';
import './RoomList.css';

// ★ 6/7 Day 22 PM: room 一覧 tab 切替 (= user voice 13:1X、Option C 同型 class 複製)
const TAB_OPTIONS = [
  { key: 'all', label: 'すべて' },
  { key: 'direct', label: '1:1 ルーム' },
  { key: 'group', label: 'グループ' },
];

function RoomList() {
  const { user } = useAuthStore();
  const { rooms, fetchRooms, error } = useRoomStore();
  const confirm = useConfirm();
  const [showCreate, setShowCreate] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const longPressTimer = useRef(null);
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
    const joinAllRooms = () => {
      rooms.forEach((room) => {
        socket.emit('room:join', room.id);
      });
    };
    joinAllRooms();

    // Re-join on reconnect (after background recovery)
    socket.on('connect', joinAllRooms);

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
      socket.off('connect', joinAllRooms);
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
        <h1>トーク</h1>
        <div className="room-list-header-actions">
          {screen.width >= 1024 && (
            <button className="icon-button" onClick={() => navigate('/multi')} title="マルチトーク">
              <Columns size={20} />
            </button>
          )}
          <button className="icon-button" onClick={() => navigate('/search')} title="検索">
            <Search size={20} />
          </button>
          {canCreateRoom(user) && (
            <button className="icon-button" onClick={() => setShowCreate(true)} title="新規作成">
              <Plus size={20} />
            </button>
          )}
        </div>
      </header>

      {error && <div className="error-bar">{error}</div>}
      <div className="room-list-user-info" onClick={() => navigate('/profile')} style={{ cursor: 'pointer' }}>
        {user?.avatar_url ? (
          <img src={`/media/${user.avatar_url}`} alt="" className="room-list-avatar" />
        ) : (
          <span className="room-list-avatar-placeholder">{user?.display_name?.charAt(0)}</span>
        )}
        {user?.display_name}（{user?.login_id}）
      </div>

      {/* ★ 6/7 Day 22 PM: tab 切替 (= room.type direct/group filter、HomePage 同型 pattern) */}
      <div className="room-list-tabs">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.key}
            className={`room-list-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(() => {
        const filteredRooms = activeTab === 'all' ? rooms : rooms.filter((r) => r.type === activeTab);
        return (
      <div className="room-list">
        {filteredRooms.length === 0 && (
          <div className="room-list-empty">
            {rooms.length === 0 ? (
              <>トークがありません。<br />+ボタンから新しいトークを始めましょう。</>
            ) : (
              <>該当するトークがありません。</>
            )}
          </div>
        )}
        {filteredRooms.map((room) => (
          <div
            key={room.id}
            className="room-item"
            onClick={() => {
              if (contextMenu) return;
              // #238: PC layout (#237) で sidebar 永続 mount のため、room click 後の
              // 未読 clear が自動で来ない。ChatRoom mount で markVisibleAsRead が
              // server cursor を進めるので、ここで optimistic に local state を更新。
              if (room.unread_count > 0) {
                useRoomStore.getState().updateRoomInList(room.id, { unread_count: 0 });
              }
              navigate(`/rooms/${room.id}`);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, roomId: room.id, roomName: getRoomDisplayName(room) });
            }}
            onTouchStart={(e) => {
              longPressTimer.current = setTimeout(() => {
                const touch = e.touches[0];
                setContextMenu({ x: touch.clientX, y: touch.clientY, roomId: room.id, roomName: getRoomDisplayName(room) });
              }, LONG_PRESS_TIMEOUT);
            }}
            onTouchEnd={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
            onTouchMove={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
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
        );
      })()}

      {showCreate && <CreateRoom onClose={() => setShowCreate(false)} />}

      {contextMenu && (
        <div className="room-context-overlay" onClick={() => setContextMenu(null)}>
          <div
            className="room-context-menu"
            style={{ top: contextMenu.y, left: Math.min(contextMenu.x, window.innerWidth - 180) }}
            onClick={e => e.stopPropagation()}
          >
            <button className="room-context-item" onClick={async () => {
              const roomId = contextMenu.roomId;
              const roomName = contextMenu.roomName;
              setContextMenu(null);
              const ok = await confirm({
                body: `「${roomName}」の未読をすべて既読にしますか？`,
                okLabel: '既読化',
              });
              if (ok) {
                try {
                  await api.request('POST', `/rooms/${roomId}/read/all`);
                  fetchRooms();
                } catch (err) {
                  console.error('Mark all read error:', err);
                }
              }
            }}>
              ✓ すべて既読
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

export default RoomList;

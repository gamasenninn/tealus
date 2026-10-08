import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMultiTalkStore, roomClickAction } from '../../stores/multiTalkStore';
import { useAuthStore } from '../../stores/authStore';
import { useRoomStore } from '../../stores/roomStore';
import { useConfirm } from '../../stores/confirmStore';
import { getSocket, joinRoom, leaveRoom } from '../../services/socket';
import { api } from '../../services/api';
import CreateRoom from './CreateRoom';
import { LONG_PRESS_TIMEOUT } from '../../constants/ui';
import { canCreateRoom } from '../../utils/permissions';
import { Search, Plus, Columns } from 'lucide-react';
import BottomNav from '../common/BottomNav';
import type { Room } from '../../types';
import { shouldPlayMessageSound } from '../../utils/messageSound';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import './RoomList.css';

// ★ 6/7 Day 22 PM: room 一覧 tab 切替 (= user voice 13:1X、Option C 同型 class 複製)
const TAB_OPTIONS = [
  { key: 'all', label: 'すべて' },
  { key: 'direct', label: '1:1 ルーム' },
  { key: 'group', label: 'グループ' },
];

// rooms 一覧 API はプレビュー用に last_message_content を返す (types.ts の Room には未定義)
type RoomRow = Room & { last_message_content?: string | null };

interface RoomContextMenuState {
  x: number;
  y: number;
  roomId: string;
  roomName: string;
}

function RoomList() {
  const { user } = useAuthStore();
  const { rooms, fetchRooms, error } = useRoomStore();
  const confirm = useConfirm();
  const [showCreate, setShowCreate] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<RoomContextMenuState | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #485-6 右クリック (長押し) メニューを Esc でも閉じる (外のクリックだけだった)
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  useEscapeToClose(!!contextMenu, closeContextMenu);
  const navigate = useNavigate();
  // ★ #502 `/multi` ではこの一覧でパネルを開く (以前は MultiTalk に別の一覧があり、ここで押すとマルチトークを抜けた)
  const { pathname } = useLocation();
  const onMulti = roomClickAction(pathname) === 'panel';
  const openRoomIds = useMultiTalkStore((s) => s.openRoomIds);

  useEffect(() => {
    fetchRooms();
    api.getOnlineUsers().then(data => setOnlineUsers(new Set((data as unknown as { online?: string[] }).online))).catch(() => {});
  }, [fetchRooms]);

  // Join all rooms for real-time updates on room list
  useEffect(() => {
    const socket = getSocket();
    if (!socket || rooms.length === 0) return;

    // Join all rooms so we receive message:new events
    // ★ #505 出入りは窓口 (joinRoom / leaveRoom) で数える。部屋の画面も同じ部屋に入るので、
    //   片方が抜けてももう片方が入っていれば抜けない
    rooms.forEach((room) => joinRoom(room.id));

    // Re-join on reconnect (after background recovery)。★ つなぎ直しは数えずに直接入る
    const joinAllRooms = () => {
      rooms.forEach((room) => {
        socket.emit('room:join', room.id);
      });
    };
    socket.on('connect', joinAllRooms);

    const handleNewMessage = (msg: { sender_id?: string; type?: string; room_id?: string; push_kind?: 'human' | 'machine' | 'off' }) => {
      fetchRooms();
      // ★ 自分・system メッセージ・通知音オフ・「このルームの通知」オフは鳴らさない (utils/messageSound)
      // ★ この effect は部屋の数が変わったときしか張り直さないので、設定は届いた時点のものを読む
      const room = useRoomStore.getState().rooms.find(r => r.id === msg.room_id);
      const prefs = {
        soundOn: useAuthStore.getState().user?.notification_sound !== false,
        roomMuted: !!room?.push_muted,
        machinePostsRing: !!room?.push_machine_posts,
      };
      if (shouldPlayMessageSound(msg, user!.id, prefs)) {
        new Audio('/notification.wav').play().catch(() => {});
      }
    };

    socket.on('message:new', handleNewMessage);

    const handleOnline = (data: { user_id: string }) => {
      setOnlineUsers(prev => new Set([...prev, data.user_id]));
    };
    const handleOffline = (data: { user_id: string }) => {
      setOnlineUsers(prev => { const next = new Set(prev); next.delete(data.user_id); return next; });
    };
    socket.on('user:online', handleOnline);
    socket.on('user:offline', handleOffline);

    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('user:online', handleOnline);
      socket.off('user:offline', handleOffline);
      socket.off('connect', joinAllRooms);
      // Leave all rooms when leaving room list (★ #505 窓口を通す。開いている部屋の画面がいれば抜けない)
      rooms.forEach((room) => leaveRoom(room.id));
    };
  }, [rooms.length, fetchRooms]);

  const formatTime = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  };

  const getPreview = (room: RoomRow) => {
    if (!room.last_message_content && room.last_message_type) {
      const typeLabels: Record<string, string> = { image: '画像', video: '動画', file: 'ファイル' };
      return typeLabels[room.last_message_type] || '';
    }
    return room.last_message_content || '';
  };

  const getRoomDisplayName = (room: RoomRow) => {
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
            className={onMulti && openRoomIds.includes(room.id) ? 'room-item open-in-panel' : 'room-item'}
            onClick={() => {
              if (contextMenu) return;
              // #238: PC layout (#237) で sidebar 永続 mount のため、room click 後の
              // 未読 clear が自動で来ない。ChatRoom mount で markVisibleAsRead が
              // server cursor を進めるので、ここで optimistic に local state を更新。
              if ((room.unread_count ?? 0) > 0) {
                useRoomStore.getState().updateRoomInList(room.id, { unread_count: 0 });
              }
              if (onMulti) {
                // ★ #502 パネルの見出しは部屋の名前だけ (グループの人数は付けない。以前の MultiTalk と同じ)
                const name = room.type === 'group' ? (room.name || '') : (room.partner_display_name || 'DM');
                useMultiTalkStore.getState().requestOpen({ id: room.id, name });
                return;
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
                {(room.unread_count ?? 0) > 0 && (
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

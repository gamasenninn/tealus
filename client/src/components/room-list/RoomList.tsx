import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMultiTalkStore, roomClickAction } from '../../stores/multiTalkStore';
import { useAuthStore } from '../../stores/authStore';
import { useRoomStore, isRoomsFetchInflight, bindRoomsChannel, fetchRoomsFromEvent } from '../../stores/roomStore';
import { useConfirm, notifyFailure } from '../../stores/confirmStore';
import { getSocket, joinRoom, leaveRoom } from '../../services/socket';
import { api } from '../../services/api';
import CreateRoom from './CreateRoom';
import { LONG_PRESS_TIMEOUT } from '../../constants/ui';
import { canCreateRoom, canSearchUsers } from '../../utils/permissions';
import { Search, Plus, Columns } from 'lucide-react';
import BottomNav from '../common/BottomNav';
import type { Room } from '../../types';
import { shouldPlayMessageSound } from '../../utils/messageSound';
import { shouldRefreshOnNewMessage } from '../../utils/roomListRefresh';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import './RoomList.css';
import { roomPreview } from '../../utils/replyQuote';
import { roomTabs, filterRoomsByTab, hiddenRoomsInTab, loadRoomTab, saveRoomTab } from '../../utils/roomTabs';

// ★ 6/7 Day 22 PM: room 一覧 tab 切替 (= user voice 13:1X、Option C 同型 class 複製)
// ★ 2026-11-13: タブの決まりは utils/roomTabs.ts (お客様の部屋のタブ・窓口のいる部屋をほかのタブから外す・選んだタブを覚える)

// rooms 一覧 API はプレビュー用に last_message_content を返す (types.ts の Room には未定義)
type RoomRow = Room & { last_message_content?: string | null };

// アイコンの無い部屋に出す 1 文字。見た目の 1 文字で取る (charAt(0) は絵文字を半分に割る)。英字は大文字に
function roomInitial(name: string | null | undefined): string {
  const first = Array.from((name || '').trim())[0];
  return first ? first.toUpperCase() : '';
}

interface RoomContextMenuState {
  x: number;
  y: number;
  roomId: string;
  roomName: string;
  isHidden: boolean;
}

function RoomList() {
  const { user } = useAuthStore();
  const { rooms, fetchRooms, error } = useRoomStore();

  // ★ 一覧の取り直しの結果を、同じ人の他のタブと分け合う (2026-11-01)
  useEffect(() => { if (user?.id) bindRoomsChannel(user.id); }, [user?.id]);
  const confirm = useConfirm();
  const [showCreate, setShowCreate] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<RoomContextMenuState | null>(null);
  // #655 一覧の下の「隠した部屋」を開いているか (覚えない。開くたびに畳んだ状態から)
  const [showHidden, setShowHidden] = useState(false);
  const tabs = useMemo(() => roomTabs(rooms), [rooms]);
  const [chosenTab, setChosenTab] = useState<string>(() => loadRoomTab(['all', 'direct', 'group', 'customer']));
  // ★ 覚えていたタブが今は出ていない (お客様の部屋が無くなった) ときは「すべて」を見せる
  const activeTab = tabs.some((t) => t.key === chosenTab) ? chosenTab : 'all';
  const setActiveTab = (key: string) => { setChosenTab(key); saveRoomTab(key); };
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
    // ★ #575 ゲストはオンラインを引けない (サーバーが 403)。呼ばない
    if (canSearchUsers(useAuthStore.getState().user)) {
      api.getOnlineUsers().then(data => setOnlineUsers(new Set(data.online))).catch(() => {});
    }
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
      fetchRooms();   // ★ #538 切れていた間の新着・未読に追いつく (以前は入り直すだけだった)
    };
    socket.on('connect', joinAllRooms);

    const handleNewMessage = (msg: { sender_id?: string; type?: string; room_id?: string; push_kind?: 'human' | 'machine' | 'off' }) => {
      // ★ この effect は部屋の数が変わったときしか張り直さないので、一覧と設定は届いた時点のものを読む
      const { rooms: current, error } = useRoomStore.getState();
      if (shouldRefreshOnNewMessage(msg.room_id, current, { inflight: isRoomsFetchInflight(), failed: !!error })) void fetchRoomsFromEvent();   // ★ 一覧に無い部屋 (管理者の見守り) では取り直さない (改善ループ 31)
      // ★ 自分・system メッセージ・通知音オフ・「このルームの通知」オフは鳴らさない (utils/messageSound)
      const room = current.find(r => r.id === msg.room_id);
      const prefs = {
        soundOn: useAuthStore.getState().user?.notification_sound !== false,
        roomMuted: !!room?.push_muted,
        machinePostsRing: !!room?.push_machine_posts || room?.type === 'direct',   // ★ 1 対 1 は鳴らす (本体の pushMachinePost と同じ、2026-10-29)
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

    // ★ #532 一覧を取り直す (鳴らさない)。以前は新着と部屋の追加・変更だけで取り直していたので、
    //   最後の投稿を編集・削除してもプレビューが古いまま、別の端末で読んでも未読数とバッジが残った
    // ★ 同じ知らせは同じ人の全タブに届くので、タブどうしで分け合う (roomStore の fetchRoomsFromEvent、2026-11-01)
    const refresh = () => { void fetchRoomsFromEvent(); };
    socket.on('unread:changed', refresh);
    socket.on('message:updated', refresh);
    socket.on('message:deleted', refresh);

    return () => {
      socket.off('unread:changed', refresh);
      socket.off('message:updated', refresh);
      socket.off('message:deleted', refresh);
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

  const getPreview = (room: RoomRow) => roomPreview(room);   // ★ #586 スタンプは UUID を出さない

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
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`room-list-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {!!tab.unreadRooms && <span className="room-list-tab-badge">{tab.unreadRooms}</span>}
          </button>
        ))}
      </div>

      {(() => {
        const filteredRooms = filterRoomsByTab(rooms, activeTab);
        const hiddenRooms = hiddenRoomsInTab(rooms, activeTab);
        const renderRoom = (room: RoomRow) => (
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
              setContextMenu({ x: e.clientX, y: e.clientY, roomId: room.id, roomName: getRoomDisplayName(room), isHidden: !!room.is_hidden });
            }}
            onTouchStart={(e) => {
              longPressTimer.current = setTimeout(() => {
                const touch = e.touches[0];
                setContextMenu({ x: touch.clientX, y: touch.clientY, roomId: room.id, roomName: getRoomDisplayName(room), isHidden: !!room.is_hidden });
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
                // ★ アイコンが無い部屋は名前の最初の 1 文字 (2026-11-23)。名前が空のときだけ絵に戻る
                roomInitial(room.type === 'group' ? room.name : room.partner_display_name)
                  || (room.type === 'group' ? '👥' : '👤')
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
        );
        return (
      <div className="room-list">
        {filteredRooms.length === 0 && hiddenRooms.length === 0 && (
          <div className="room-list-empty">
            {rooms.length === 0 ? (
              // ★ 部屋を作れない人 (ゲスト) には + が無いので、招待を待つ文にする (2026-10-29 小野さん判断 6)
              canCreateRoom(user)
                ? <>トークがありません。<br />+ボタンから新しいトークを始めましょう。</>
                : <>まだトークがありません。<br />招待されるとここに出ます。</>
            ) : (
              <>該当するトークがありません。</>
            )}
          </div>
        )}
        {filteredRooms.map(renderRoom)}
        {/* #655 自分の一覧から隠した部屋。新しい投稿が来ると本体が is_hidden=false を返すので、上の並びに自動で戻る */}
        {hiddenRooms.length > 0 && (
          <div className='room-list-hidden'>
            <button className='room-list-hidden-toggle' onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? '▾' : '▸'} 隠した部屋（{hiddenRooms.length}）
            </button>
            {showHidden && hiddenRooms.map(renderRoom)}
          </div>
        )}
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
                  // ★ つながっていれば取り直さない。本体の unread:changed がこのタブにも届く (改善ループ 38、2 本取っていた)
                  if (!getSocket()?.connected) fetchRooms();
                } catch (err) {
                  console.error('Mark all read error:', err);
                  notifyFailure('既読化', err);
                }
              }
            }}>
              ✓ すべて既読
            </button>
            {/* #655 自分の一覧からだけ隠す。ほかの人の一覧・メッセージ・検索は変わらない。新しい投稿が来たら自動で戻る */}
            <button className="room-context-item" onClick={async () => {
              const { roomId, isHidden } = contextMenu;
              setContextMenu(null);
              try {
                const r = await api.setRoomHidden(roomId, !isHidden);
                useRoomStore.getState().updateRoomInList(roomId, { is_hidden: r.is_hidden });
              } catch (err) {
                console.error('Hide room error:', err);
                notifyFailure(isHidden ? '一覧に戻す' : '一覧から隠す', err);
              }
            }}>
              {contextMenu.isHidden ? '↩ 一覧に戻す' : '🙈 一覧から隠す'}
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

export default RoomList;

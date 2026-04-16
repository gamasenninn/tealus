import { useState, useEffect, useRef } from 'react';
import { Rnd } from 'react-rnd';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';
import { getSocket } from '../../services/socket';
import { LayoutGrid, X, Columns, PanelLeftClose, Menu, Maximize2, Minimize2, Square } from 'lucide-react';
import './MultiTalk.css';

function MultiTalk() {
  const { user } = useAuthStore();
  const [rooms, setRooms] = useState([]);
  const [panels, setPanels] = useState(() => {
    try {
      const saved = localStorage.getItem('multiTalkPanels');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activePanel, setActivePanel] = useState(null);
  const [interacting, setInteracting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const containerRef = useRef(null);
  const panelCounter = useRef((() => {
    try {
      const saved = localStorage.getItem('multiTalkPanels');
      const p = saved ? JSON.parse(saved) : [];
      return p.length > 0 ? Math.max(...p.map(x => x.id)) : 0;
    } catch { return 0; }
  })());

  // panels 変更時に localStorage に保存
  useEffect(() => {
    localStorage.setItem('multiTalkPanels', JSON.stringify(panels));
  }, [panels]);

  // ルーム一覧取得
  useEffect(() => {
    api.getRooms().then(d => setRooms(d.rooms || [])).catch(() => {});
  }, []);

  // Socket.IO で未読更新
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleMessage = (msg) => {
      if (msg.sender_id === user.id) return;
      // 開いているパネルのルームは未読を増やさない
      setPanels(currentPanels => {
        const isOpen = currentPanels.some(p => p.roomId === msg.room_id);
        if (!isOpen) {
          setRooms(prev => prev.map(r =>
            r.id === msg.room_id ? { ...r, unread_count: (r.unread_count || 0) + 1 } : r
          ));
        }
        return currentPanels;
      });
    };

    const handleRead = (data) => {
      if (data.room_id) {
        setRooms(prev => prev.map(r =>
          r.id === data.room_id ? { ...r, unread_count: 0 } : r
        ));
      }
    };

    socket.on('message:new', handleMessage);
    socket.on('message:read', handleRead);
    return () => {
      socket.off('message:new', handleMessage);
      socket.off('message:read', handleRead);
    };
  }, [user]);

  // パネル追加
  const openPanel = (room) => {
    // 既に開いていればフォーカス
    const existing = panels.find(p => p.roomId === room.id);
    if (existing) {
      setActivePanel(existing.id);
      return;
    }

    const container = containerRef.current;
    const cw = container ? container.clientWidth : 800;
    const ch = container ? container.clientHeight : 600;
    const width = Math.min(500, cw - 40);
    const height = Math.min(ch - 40, 800);
    const offset = (panels.length % 5) * 30;

    const newPanel = {
      id: ++panelCounter.current,
      roomId: room.id,
      roomName: room.name || room.partner_display_name || 'DM',
      x: 20 + offset,
      y: 20 + offset,
      width,
      height,
    };

    setPanels(prev => [...prev, newPanel]);
    setActivePanel(newPanel.id);

    // 未読クリア
    setRooms(prev => prev.map(r =>
      r.id === room.id ? { ...r, unread_count: 0 } : r
    ));
  };

  // パネル閉じる
  const closePanel = (id) => {
    setPanels(prev => prev.filter(p => p.id !== id));
    if (activePanel === id) setActivePanel(null);
  };

  // 一括整列: タイル
  const arrangeTile = () => {
    const container = containerRef.current;
    if (!container || panels.length === 0) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const cols = Math.ceil(Math.sqrt(panels.length));
    const rows = Math.ceil(panels.length / cols);
    const w = Math.floor(cw / cols) - 8;
    const h = Math.floor(ch / rows) - 8;

    setPanels(prev => prev.map((p, i) => ({
      ...p,
      x: (i % cols) * (w + 8) + 4,
      y: Math.floor(i / cols) * (h + 8) + 4,
      width: w,
      height: h,
    })));
  };

  // 一括整列: 横並び
  const arrangeColumns = () => {
    const container = containerRef.current;
    if (!container || panels.length === 0) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const w = Math.floor(cw / panels.length) - 8;

    setPanels(prev => prev.map((p, i) => ({
      ...p,
      x: i * (w + 8) + 4,
      y: 4,
      width: w,
      height: ch - 8,
    })));
  };

  // 最大化: パネルエリア全体に
  const maximizePanel = (id) => {
    const container = containerRef.current;
    if (!container) return;
    setPanels(prev => prev.map(p => p.id === id ? {
      ...p, x: 4, y: 4, width: container.clientWidth - 8, height: container.clientHeight - 8,
    } : p));
  };

  // 最小化: ヘッダーだけに
  const minimizePanel = (id) => {
    setPanels(prev => prev.map(p => p.id === id ? {
      ...p, height: 40,
    } : p));
  };

  // 普通サイズ: デフォルトサイズに
  const restorePanel = (id) => {
    const container = containerRef.current;
    if (!container) return;
    setPanels(prev => prev.map(p => p.id === id ? {
      ...p, width: Math.min(500, container.clientWidth - 40), height: Math.min(container.clientHeight - 40, 800),
    } : p));
  };

  const getRoomDisplayName = (room) => {
    if (room.type === 'group') return room.name;
    return room.partner_display_name || 'DM';
  };

  return (
    <div className="multi-talk">
      {/* ツールバー（常に表示） */}
      <div className="multi-toolbar">
        <button onClick={() => setSidebarOpen(prev => !prev)} title={sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'}>
          {sidebarOpen ? <PanelLeftClose size={18} /> : <Menu size={18} />}
        </button>
        <div className="multi-toolbar-divider" />
        <button onClick={arrangeTile} title="タイル整列"><LayoutGrid size={18} /></button>
        <button onClick={arrangeColumns} title="横並び整列"><Columns size={18} /></button>
      </div>

      {/* サイドバー（トグル） */}
      {sidebarOpen && (
      <div className="multi-sidebar">
        <div className="multi-sidebar-header">
          <h2>トーク</h2>
        </div>
        <div className="multi-room-list">
          {rooms.map(room => {
            const isOpen = panels.some(p => p.roomId === room.id);
            return (
              <div
                key={room.id}
                className={`multi-room-item ${isOpen ? 'open' : ''}`}
                onClick={() => openPanel(room)}
              >
                <span className="multi-room-name">{getRoomDisplayName(room)}</span>
                {room.unread_count > 0 && (
                  <span className="multi-unread">{room.unread_count}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      <div className="multi-panels" ref={containerRef}>
        {panels.length === 0 && (
          <div className="multi-empty">左のルーム一覧からルームを選択してください</div>
        )}
        {panels.map(panel => (
          <Rnd
            key={panel.id}
            position={{ x: panel.x, y: panel.y }}
            size={{ width: panel.width, height: panel.height }}
            minWidth={320}
            minHeight={300}
            bounds="parent"
            dragHandleClassName="multi-panel-header"
            onDragStart={() => setInteracting(true)}
            onDragStop={(e, d) => {
              setInteracting(false);
              setPanels(prev => prev.map(p => p.id === panel.id ? { ...p, x: d.x, y: d.y } : p));
            }}
            onResizeStart={() => setInteracting(true)}
            onResizeStop={(e, dir, ref, delta, pos) => {
              setInteracting(false);
              setPanels(prev => prev.map(p => p.id === panel.id ? {
                ...p,
                width: parseInt(ref.style.width),
                height: parseInt(ref.style.height),
                x: pos.x,
                y: pos.y,
              } : p));
            }}
            onMouseDown={() => setActivePanel(panel.id)}
            style={{ zIndex: activePanel === panel.id ? 10 : 1 }}
          >
            <div className={`multi-panel ${activePanel === panel.id ? 'active' : ''}`}>
              <div className="multi-panel-header">
                <span className="multi-panel-title">{panel.roomName}</span>
                <div className="multi-panel-btns">
                  <button className="multi-panel-btn" onClick={(e) => { e.stopPropagation(); minimizePanel(panel.id); }} title="最小化"><Minimize2 size={12} /></button>
                  <button className="multi-panel-btn" onClick={(e) => { e.stopPropagation(); restorePanel(panel.id); }} title="普通サイズ"><Square size={12} /></button>
                  <button className="multi-panel-btn" onClick={(e) => { e.stopPropagation(); maximizePanel(panel.id); }} title="最大化"><Maximize2 size={12} /></button>
                  <button className="multi-panel-close" onClick={(e) => { e.stopPropagation(); closePanel(panel.id); }} title="閉じる"><X size={12} /></button>
                </div>
              </div>
              <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                <iframe
                  className="multi-panel-iframe"
                  src={`/rooms/${panel.roomId}?embed=true`}
                  title={panel.roomName}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', pointerEvents: interacting ? 'none' : 'auto' }}
                />
                {interacting && <div style={{ position: 'absolute', inset: 0 }} />}
              </div>
            </div>
          </Rnd>
        ))}
      </div>
    </div>
  );
}

export default MultiTalk;

import { useState, useEffect, useRef } from 'react';
import { Rnd } from 'react-rnd';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, X, Columns, PanelLeftClose, Menu, Maximize2, Minimize2, Square, MonitorSmartphone, GripHorizontal } from 'lucide-react';
import { useMultiTalkStore, type MultiTalkRoomRef } from '../../stores/multiTalkStore';
import './MultiTalk.css';

/*
 * ★ #502 (2026-10-05) 部屋の一覧は持たない。左の RoomList (DesktopShell) 1 つだけで、
 *   `/multi` ではそこで押すと「開いて」が店 (multiTalkStore) に置かれ、ここで受け取ってパネルにする。
 *   以前は自前の一覧 (.multi-sidebar) を持っていて、#237 で PC 全体の一覧が入ってから
 *   「トーク」が 2 つ並んでいた (左端で押すとマルチトークを抜けた)。
 *   未読の数え方も自前で持っていたが、RoomList が新着のたびにサーバーから取り直すので要らない
 */

/** #503 最小化したパネルの高さ = 帯 (MultiTalk.css の 18px) + 枠線 上下 1px。以前は 40 (帯が太かった) */
const MINIMIZED_HEIGHT = 20;

/** 開いているトークパネル 1 枚分 (localStorage 'multiTalkPanels' に永続化) */
interface TalkPanel {
  id: number;
  roomId: string;
  roomName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** #503 最小化している (帯だけ見える) とき、帯に名前を出す。前に保存したパネルには無い = 普通 */
  minimized?: boolean;
}

function MultiTalk() {
  const navigate = useNavigate();
  const pendingOpen = useMultiTalkStore((s) => s.pendingOpen);
  const sidebarHidden = useMultiTalkStore((s) => s.sidebarHidden);
  const [panels, setPanels] = useState<TalkPanel[]>(() => {
    try {
      const saved = localStorage.getItem('multiTalkPanels');
      return saved ? (JSON.parse(saved) as TalkPanel[]) : [];
    } catch { return []; }
  });
  const [activePanel, setActivePanel] = useState<number | null>(null);
  const [interacting, setInteracting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelCounter = useRef((() => {
    try {
      const saved = localStorage.getItem('multiTalkPanels');
      const p = saved ? (JSON.parse(saved) as TalkPanel[]) : [];
      return p.length > 0 ? Math.max(...p.map(x => x.id)) : 0;
    } catch { return 0; }
  })());

  // panels 変更時に localStorage に保存。★ #502 開いている部屋を左の一覧の印のために店へ知らせる
  useEffect(() => {
    localStorage.setItem('multiTalkPanels', JSON.stringify(panels));
    useMultiTalkStore.getState().setOpenRoomIds(panels.map(p => p.roomId));
  }, [panels]);

  // PC PWA: マルチトーク画面ではウィンドウを広げ、パネルを自動整列
  useEffect(() => {
    if (!window.matchMedia('(display-mode: standalone)').matches) return;
    const prevWidth = window.outerWidth;
    const prevHeight = window.outerHeight;

    // 前回のサイズを復元、なければ画面幅に合わせる
    const savedSize = JSON.parse(localStorage.getItem('multiTalkWindowSize') || 'null') as { width?: number; height?: number } | null;
    const width = savedSize?.width || Math.min(screen.width, 1400);
    const height = savedSize?.height || window.outerHeight;

    window.resizeTo(width, height);
    setTimeout(() => rearrange(), 300);

    // ウィンドウサイズ変更時に保存
    const saveSize = () => {
      localStorage.setItem('multiTalkWindowSize', JSON.stringify({
        width: window.outerWidth,
        height: window.outerHeight,
      }));
    };
    window.addEventListener('resize', saveSize);

    return () => {
      window.removeEventListener('resize', saveSize);
      saveSize(); // 離脱時にも保存
      window.resizeTo(prevWidth, prevHeight);
    };
  }, []);

  // ★ #502 左の一覧 (RoomList) で押された部屋を受け取ってパネルにする
  useEffect(() => {
    if (!pendingOpen) return;
    const room = useMultiTalkStore.getState().takeOpen();
    if (room) openPanel(room);
    // openPanel は panels を読むので、押されたときの最新の panels で動く (pendingOpen が変わるたび)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpen]);

  // パネル追加
  const openPanel = (room: MultiTalkRoomRef) => {
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

    const newPanel: TalkPanel = {
      id: ++panelCounter.current,
      roomId: room.id,
      roomName: room.name || 'DM',
      x: 20 + offset,
      y: 20 + offset,
      width,
      height,
    };

    setPanels(prev => [...prev, newPanel]);
    setActivePanel(newPanel.id);
    // 未読はその場で 0 にする処理を RoomList が押したときにしている (#238 と同じ)
  };

  // パネル閉じる
  const closePanel = (id: number) => {
    setPanels(prev => prev.filter(p => p.id !== id));
    if (activePanel === id) setActivePanel(null);
  };

  // 現在の配置モードで再整列
  const rearrange = () => {
    const mode = localStorage.getItem('multiTalkLayout') || 'tile';
    if (mode === 'columns') arrangeColumns();
    else arrangeTile();
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
      minimized: false,
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
      minimized: false,
    })));
  };

  // 最大化: パネルエリア全体に
  const maximizePanel = (id: number) => {
    const container = containerRef.current;
    if (!container) return;
    setPanels(prev => prev.map(p => p.id === id ? {
      ...p, x: 4, y: 4, width: container.clientWidth - 8, height: container.clientHeight - 8, minimized: false,
    } : p));
  };

  // 最小化: ヘッダーだけに
  const minimizePanel = (id: number) => {
    setPanels(prev => prev.map(p => p.id === id ? {
      ...p, height: MINIMIZED_HEIGHT, minimized: true,
    } : p));
  };

  // 普通サイズ: デフォルトサイズに
  const restorePanel = (id: number) => {
    const container = containerRef.current;
    if (!container) return;
    setPanels(prev => prev.map(p => p.id === id ? {
      ...p, width: Math.min(500, container.clientWidth - 40), height: Math.min(container.clientHeight - 40, 800), minimized: false,
    } : p));
  };

  return (
    <div className="multi-talk">
      {/* ツールバー（常に表示） */}
      <div className="multi-toolbar">
        {/* ★ #502 左の一覧 (RoomList) を隠す / 出す。パネルを広く使う役目は以前の「サイドバー」と同じ */}
        <button onClick={() => useMultiTalkStore.getState().toggleSidebar()} title={sidebarHidden ? '一覧を出す' : '一覧を隠す'}>
          {sidebarHidden ? <Menu size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <div className="multi-toolbar-divider" />
        <button onClick={() => { localStorage.setItem('multiTalkLayout', 'tile'); arrangeTile(); }} title="タイル整列"><LayoutGrid size={18} /></button>
        <button onClick={() => { localStorage.setItem('multiTalkLayout', 'columns'); arrangeColumns(); }} title="横並び整列"><Columns size={18} /></button>
        <div className="multi-toolbar-divider" />
        <button onClick={() => navigate('/talk')} title="シングルモードに戻る"><MonitorSmartphone size={18} /></button>
      </div>

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
            // ★ #503 最小化中は最小の高さも帯の高さに。300 のままだと min-height で引き戻され、
            //   最小化が #123 以来効いていなかった (高さは 40 にしていたが画面は 300 のまま)
            minHeight={panel.minimized ? MINIMIZED_HEIGHT : 300}
            enableResizing={!panel.minimized}
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
                minimized: false,
              } : p));
            }}
            onMouseDown={() => setActivePanel(panel.id)}
            style={{ zIndex: activePanel === panel.id ? 10 : 1 }}
          >
            <div className={`multi-panel ${activePanel === panel.id ? 'active' : ''}`}>
              {/* ★ #503 帯はドラッグのつかみ (中身は iframe なので、中の見出しではつかめない)。
                    部屋の名前は中の見出しに出るので、ここには最小化したときだけ出す (帯しか見えないため)。
                    色は #123 の「つかむ帯と部屋の見出しをはっきり区別する」で濃い灰色のまま */}
              <div className="multi-panel-header" title={panel.roomName} aria-label={panel.roomName}>
                {panel.minimized
                  ? <span className="multi-panel-title">{panel.roomName}</span>
                  : <GripHorizontal className="multi-panel-grip" size={14} aria-hidden="true" />}
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

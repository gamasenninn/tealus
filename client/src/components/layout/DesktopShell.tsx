/**
 * Desktop 2-pane shell (#237 Phase 1)
 *
 * Mobile (< 1024px): sidebar 非表示、main pane 全画面 (既存 mobile UX 維持)
 * Desktop (>= 1024px): sidebar (RoomList) + main pane (Outlet) の 2-pane layout
 *
 * CSS media query で切替、JS state branching なし。
 * 認証必須 routes をラップする (PrivateRoute → DesktopShell → 各画面)。
 *
 * ★ #487 RoomList はこのサイドバーの 1 つだけ。スマホでも CSS で隠しているだけで常に動いている
 *   (トークを開いている間もほかの部屋の新着の音を鳴らす)。`/talk` では本体に一覧を置かず、
 *   スマホはサイドバーを全画面で出す (.desktop-shell--talk)。以前は本体にも置いて、一覧が 2 つ動いていた
 */
import { Outlet, useLocation } from 'react-router-dom';
import RoomList from '../room-list/RoomList';
import './DesktopShell.css';

function DesktopShell() {
  const { pathname } = useLocation();
  const onTalk = pathname === '/talk';
  return (
    <div className={onTalk ? 'desktop-shell desktop-shell--talk' : 'desktop-shell'}>
      <aside className="desktop-sidebar">
        <RoomList />
      </aside>
      <main className="desktop-main">
        <Outlet />
      </main>
    </div>
  );
}

export default DesktopShell;

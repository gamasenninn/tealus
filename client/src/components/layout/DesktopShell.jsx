/**
 * Desktop 2-pane shell (#237 Phase 1)
 *
 * Mobile (< 1024px): sidebar 非表示、main pane 全画面 (既存 mobile UX 維持)
 * Desktop (>= 1024px): sidebar (RoomList) + main pane (Outlet) の 2-pane layout
 *
 * CSS media query で切替、JS state branching なし。
 * 認証必須 routes をラップする (PrivateRoute → DesktopShell → 各画面)。
 */
import { Outlet } from 'react-router-dom';
import RoomList from '../room-list/RoomList';
import './DesktopShell.css';

function DesktopShell() {
  return (
    <div className="desktop-shell">
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

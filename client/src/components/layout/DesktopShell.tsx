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
import { useMultiTalkStore } from '../../stores/multiTalkStore';
import './DesktopShell.css';

function DesktopShell() {
  const { pathname, search } = useLocation();
  const sidebarHidden = useMultiTalkStore((s) => s.sidebarHidden);
  // ★ #502 マルチトークのパネルの中身 (iframe の `/rooms/:id?embed=true`) では一覧を出さず、動かさない。
  //   包んでいたので、見えない RoomList がパネルの数だけ動き、通知音が重なっていた (パネル 3 枚で 4 回)。
  //   新着の音は外側の 1 つが鳴らす
  if (new URLSearchParams(search).get('embed') === 'true') {
    return <Outlet />;
  }
  const onTalk = pathname === '/talk';
  // ★ #502 `/multi` では一覧は RoomList 1 つだけ (押すとパネルを開く)。幅が狭くても出す。
  //   ツールバーで隠せるのは `/multi` の中だけ
  const onMulti = pathname === '/multi';
  const cls = ['desktop-shell'];
  if (onTalk) cls.push('desktop-shell--talk');
  if (onMulti) cls.push('desktop-shell--multi');
  if (onMulti && sidebarHidden) cls.push('desktop-shell--sidebar-hidden');
  return (
    <div className={cls.join(' ')}>
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

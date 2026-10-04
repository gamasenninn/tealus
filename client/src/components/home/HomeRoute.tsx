import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { isGuest } from '../../utils/permissions';
import HomePage from './HomePage';

/**
 * `/` の入口。★ #494-2 ゲストはトーク一覧へ回す。
 * ホームは社内の画面 (お知らせ・ポータル) で、ゲストにはタブも出さない (#282)。
 * 以前はログイン直後にだけ、空の「お知らせはありません」が出ていた。
 */
function HomeRoute() {
  const { user } = useAuthStore();
  if (isGuest(user)) return <Navigate to="/talk" replace />;
  return <HomePage />;
}

export default HomeRoute;

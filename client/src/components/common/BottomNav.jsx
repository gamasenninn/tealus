import { useLocation, useNavigate } from 'react-router-dom';
import { Home, MessageCircle, User } from 'lucide-react';
import './BottomNav.css';

const NAV_ITEMS = [
  { path: '/', icon: Home, label: 'ホーム' },
  { path: '/talk', icon: MessageCircle, label: 'トーク' },
  { path: '/profile', icon: User, label: 'プロフィール' },
];

function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(item => {
        const Icon = item.icon;
        const isActive = location.pathname === item.path;
        return (
          <button
            key={item.path}
            className={`bottom-nav-item ${isActive ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            <Icon size={22} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default BottomNav;

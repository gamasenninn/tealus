import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Bot, MessageSquare, Activity, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

function Sidebar() {
  const { logout } = useAuthStore();

  const links = [
    { to: '/', icon: LayoutDashboard, label: '概要' },
    { to: '/agents', icon: Bot, label: 'エージェント' },
    { to: '/rooms', icon: MessageSquare, label: 'ルーム' },
    { to: '/monitor', icon: Activity, label: 'モニタリング' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Tealus</h1>
        <span className="sidebar-subtitle">System Dashboard</span>
      </div>
      <nav className="sidebar-nav">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-link" onClick={logout}>
          <LogOut size={18} />
          <span>ログアウト</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;

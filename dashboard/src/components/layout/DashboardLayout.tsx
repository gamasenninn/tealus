import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { Menu } from 'lucide-react';

function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className={`dashboard-layout ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      {/* モバイル用オーバーレイ */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen(prev => !prev)} />
      <main className="dashboard-main">
        {!sidebarOpen && (
          <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
        )}
        <Outlet />
      </main>
    </div>
  );
}

export default DashboardLayout;

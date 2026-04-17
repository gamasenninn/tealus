import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Login from './components/auth/Login';
import DashboardLayout from './components/layout/DashboardLayout';
import Overview from './pages/Overview';
import Agents from './pages/Agents';
import Rooms from './pages/Rooms';
import Monitor from './pages/Monitor';
import AgentSettings from './pages/AgentSettings';
import RoomSettings from './pages/RoomSettings';

function AdminRoute({ children }) {
  const { user, isLoading } = useAuthStore();
  if (isLoading) return <div className="loading">読み込み中...</div>;
  if (!user) return <Navigate to="/login" />;
  if (user.role !== 'admin') return <div className="loading">管理者権限が必要です</div>;
  return children;
}

function App() {
  const { initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <BrowserRouter basename="/system">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<AdminRoute><DashboardLayout /></AdminRoute>}>
          <Route index element={<Overview />} />
          <Route path="agents" element={<Agents />} />
          <Route path="agents/settings" element={<AgentSettings />} />
          <Route path="rooms" element={<Rooms />} />
          <Route path="rooms/:roomId" element={<RoomSettings />} />
          <Route path="monitor" element={<Monitor />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

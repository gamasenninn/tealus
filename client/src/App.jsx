import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Login from './components/auth/Login';
import HomePage from './components/home/HomePage';
import RoomList from './components/room-list/RoomList';
import ChatRoom from './components/chat/ChatRoom';
import AdminDashboard from './components/admin/AdminDashboard';
import Profile from './components/profile/Profile';
import SearchPage from './components/search/SearchPage';
import MediaGallery from './components/media/MediaGallery';
import './index.css';

function PrivateRoute({ children }) {
  const { user, isLoading } = useAuthStore();
  if (isLoading) return <div className="loading">読み込み中...</div>;
  return user ? children : <Navigate to="/login" />;
}

function App() {
  const { initialize, isLoading } = useAuthStore();

  useEffect(() => {
    initialize();
    // Load font size setting from localStorage
    const fontSize = localStorage.getItem('chatFontSize') || 'medium';
    document.documentElement.setAttribute('data-chat-font', fontSize === 'medium' ? '' : fontSize);
  }, [initialize]);

  if (isLoading) {
    return <div className="loading">読み込み中...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PrivateRoute><HomePage /></PrivateRoute>} />
        <Route path="/talk" element={<PrivateRoute><RoomList /></PrivateRoute>} />
        <Route path="/rooms/:roomId" element={<PrivateRoute><ChatRoom /></PrivateRoute>} />
        <Route path="/rooms/:roomId/gallery" element={<PrivateRoute><MediaGallery /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
        <Route path="/search" element={<PrivateRoute><SearchPage /></PrivateRoute>} />
        <Route path="/admin" element={<PrivateRoute><AdminDashboard /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

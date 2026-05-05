import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useCapabilityStore } from './stores/capabilityStore';
import { useCallNotification } from './hooks/useCallNotification';
import Login from './components/auth/Login';
import HomePage from './components/home/HomePage';
import RoomList from './components/room-list/RoomList';
import ChatRoom from './components/chat/ChatRoom';
import AdminDashboard from './components/admin/AdminDashboard';
import Profile from './components/profile/Profile';
import SearchPage from './components/search/SearchPage';
import MediaGallery from './components/media/MediaGallery';
import MultiTalk from './components/multi/MultiTalk';
import SharePage from './components/share/SharePage';
import IncomingCallModal from './components/call/IncomingCallModal';
import CallWindow from './components/call/CallWindow';
import CallBanner from './components/call/CallBanner';
import ConfirmModal from './components/common/ConfirmModal';
import TtsStopButton from './components/common/TtsStopButton';
import DesktopShell from './components/layout/DesktopShell';
import './index.css';

function PrivateRoute({ children }) {
  const { user, isLoading } = useAuthStore();
  if (isLoading) return <div className="loading">読み込み中...</div>;
  return user ? children : <Navigate to="/login" />;
}

function App() {
  const { initialize, isLoading, user } = useAuthStore();
  const realtimeVoiceAvailable = useCapabilityStore((s) => s.realtimeVoiceAvailable);
  const { incomingCall, activeCall, acceptCall, rejectCall, endCall, getCallUrl } = useCallNotification();

  useEffect(() => {
    initialize();
    // Load font size setting from localStorage
    const fontSize = localStorage.getItem('chatFontSize') || 'medium';
    document.documentElement.setAttribute('data-chat-font', fontSize === 'medium' ? '' : fontSize);
  }, [initialize]);

  if (isLoading) {
    return <div className="loading">読み込み中...</div>;
  }

  const callUrl = getCallUrl();

  return (
    <BrowserRouter>
      <ConfirmModal />
      {user && <TtsStopButton />}
      {user && realtimeVoiceAvailable && incomingCall && (
        <IncomingCallModal
          callerName={incomingCall.callerName}
          onAccept={acceptCall}
          onReject={rejectCall}
        />
      )}
      {user && realtimeVoiceAvailable && activeCall && callUrl && (
        <CallWindow callUrl={callUrl} onEnd={endCall} />
      )}
      {user && realtimeVoiceAvailable && activeCall && (
        <CallBanner />
      )}
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* 認証必須 routes は DesktopShell でラップ (#237 Phase 1)
            Mobile (< 1024px): shell の sidebar 非表示で main 全画面 (既存 UX 維持)
            Desktop (>= 1024px): sidebar (RoomList) + main pane (各画面) の 2-pane */}
        <Route element={<PrivateRoute><DesktopShell /></PrivateRoute>}>
          <Route path="/" element={<HomePage />} />
          <Route path="/talk" element={<RoomList />} />
          <Route path="/rooms/:roomId" element={<ChatRoom />} />
          <Route path="/rooms/:roomId/gallery" element={<MediaGallery />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/multi" element={<MultiTalk />} />
          <Route path="/share" element={<SharePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

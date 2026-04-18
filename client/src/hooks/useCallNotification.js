import { useState, useEffect, useCallback } from 'react';
import { getSocket } from '../services/socket';
import { useAuthStore } from '../stores/authStore';

export function useCallNotification() {
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null); // { roomId }
  const { token, user } = useAuthStore();

  // Socket イベントリスナー（user が変わったら再登録 = ログイン後に確実に登録）
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !user) return;

    const handleIncoming = (data) => {
      setIncomingCall((prev) => prev || data);
    };

    const handleEnded = (data) => {
      setActiveCall((prev) => prev?.roomId === data.roomId ? null : prev);
      setIncomingCall((prev) => prev?.roomId === data.roomId ? null : prev);
    };

    const handleRejected = (data) => {
      setActiveCall((prev) => {
        if (prev?.roomId === data.roomId) {
          alert(`${data.userName} が通話を拒否しました`);
          return null;
        }
        return prev;
      });
    };

    socket.on('call:incoming', handleIncoming);
    socket.on('call:ended', handleEnded);
    socket.on('call:rejected', handleRejected);

    return () => {
      socket.off('call:incoming', handleIncoming);
      socket.off('call:ended', handleEnded);
      socket.off('call:rejected', handleRejected);
    };
  }, [user]);

  // 通話ウィンドウからの切断通知を受け取る
  useEffect(() => {
    const handleMessage = (e) => {
      if (e.data?.type === 'call:ended') {
        // call:end を emit してから状態をクリア（通話履歴記録のため）
        setActiveCall((prev) => {
          if (prev) {
            const socket = getSocket();
            if (socket) socket.emit('call:end', { roomId: prev.roomId });
          }
          return null;
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // ChatRoom からの通話開始イベントを受け取る
  useEffect(() => {
    const handleCallStart = (e) => {
      const { roomId } = e.detail;
      if (roomId) setActiveCall({ roomId });
    };
    window.addEventListener('call:start', handleCallStart);
    return () => window.removeEventListener('call:start', handleCallStart);
  }, []);

  const startCall = useCallback((roomId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('call:start', { roomId });
    setActiveCall({ roomId });
  }, []);

  const acceptCall = useCallback(() => {
    if (!incomingCall) return;
    setActiveCall({ roomId: incomingCall.roomId });
    setIncomingCall(null);
  }, [incomingCall]);

  const rejectCall = useCallback(() => {
    if (!incomingCall) return;
    const socket = getSocket();
    if (socket) {
      socket.emit('call:reject', { roomId: incomingCall.roomId, callerId: incomingCall.callerId });
    }
    setIncomingCall(null);
  }, [incomingCall]);

  const endCall = useCallback(() => {
    if (!activeCall) return;
    const socket = getSocket();
    if (socket) {
      socket.emit('call:end', { roomId: activeCall.roomId });
    }
    setActiveCall(null);
  }, [activeCall]);

  const getCallUrl = useCallback(() => {
    if (!activeCall || !token) return null;
    return `/rtc/?room=${activeCall.roomId}&token=${encodeURIComponent(token)}`;
  }, [activeCall, token]);

  return {
    incomingCall,
    activeCall,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    getCallUrl,
  };
}

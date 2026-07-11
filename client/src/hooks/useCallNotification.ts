import { useState, useEffect, useCallback } from 'react';
import { getSocket } from '../services/socket';
import { useAuthStore } from '../stores/authStore';
import { useCapabilityStore } from '../stores/capabilityStore';

// --- Socket.IO / CustomEvent payload (client が消費するフィールドのみ最小型付け) ---

export interface IncomingCall {
  roomId: string;
  callerId?: string;
  callerName?: string;
}

export interface ActiveCall {
  roomId: string;
  video?: boolean;
  audio?: boolean;
}

interface CallEndedPayload {
  roomId: string;
}

interface CallRejectedPayload {
  roomId: string;
  userName?: string;
}

export interface UseCallNotificationResult {
  incomingCall: IncomingCall | null;
  activeCall: ActiveCall | null;
  startCall: (roomId: string) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
  getCallUrl: () => string | null;
}

export function useCallNotification(): UseCallNotificationResult {
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null); // { roomId }
  const { token, user } = useAuthStore();

  // Socket イベントリスナー（user が変わったら再登録 = ログイン後に確実に登録）
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !user) return;

    const handleIncoming = (data: IncomingCall) => {
      // Safety net: rtc-server 不可時は incoming を無視 (UI 非表示と二重防御)
      if (!useCapabilityStore.getState().realtimeVoiceAvailable) return;
      setIncomingCall((prev) => prev || data);
    };

    const handleEnded = (data: CallEndedPayload) => {
      // 他の参加者が退出しても自分の通話は維持（グループ通話対応）
      // activeCall は閉じない — 通話ウィンドウの close 検知で管理
      setIncomingCall((prev) => prev?.roomId === data.roomId ? null : prev);
    };

    const handleRejected = (data: CallRejectedPayload) => {
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
    const handleMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string } | null | undefined;
      if (data?.type === 'call:ended') {
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
    const handleCallStart = (e: Event) => {
      const { roomId, video = true, audio = true } = (e as CustomEvent<{ roomId?: string; video?: boolean; audio?: boolean }>).detail;
      if (roomId) setActiveCall({ roomId, video, audio });
    };
    window.addEventListener('call:start', handleCallStart);
    return () => window.removeEventListener('call:start', handleCallStart);
  }, []);

  const startCall = useCallback((roomId: string) => {
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
    let url = `/rtc/?room=${activeCall.roomId}&token=${encodeURIComponent(token)}`;
    if (activeCall.video === false) url += '&video=false';
    if (activeCall.audio === false) url += '&audio=false';
    return url;
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

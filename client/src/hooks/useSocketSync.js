import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { useMessageStore } from '../stores/messageStore';
import { getSocket } from '../services/socket';
import { api } from '../services/api';
import { speakAuto } from '../services/browserTts';
import { playTtsSrc } from '../services/ttsAudioPlayer';

/**
 * Manages all Socket.IO event subscriptions for a chat room.
 * Also handles room initialization and cleanup.
 * Returns typingUsers state.
 */
export function useSocketSync(roomId, targetMsgId = null) {
  const { user } = useAuthStore();
  const { selectRoom, clearCurrentRoom } = useRoomStore();
  const { addMessage, fetchMessages, clearMessages, updateMessageContent } = useMessageStore();
  const [typingUsers, setTypingUsers] = useState({});
  const [agentStatus, setAgentStatus] = useState(null);

  useEffect(() => {
    selectRoom(roomId);
    fetchMessages(roomId, targetMsgId || null);

    // Re-fetch messages when app returns from background
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchMessages(roomId);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const socket = getSocket();
    if (socket) {
      socket.emit('room:join', roomId);

      // Re-join room on reconnect (after background recovery etc.)
      socket.on('connect', () => {
        socket.emit('room:join', roomId);
      });

      socket.on('message:new', (msg) => {
        if (msg.room_id !== roomId) return; // 自分のルームのメッセージのみ処理
        addMessage(msg);
        if (msg.sender_id !== user.id) {
          api.markRead(roomId, [msg.id]).catch(() => {});
          socket.emit('message:read', { room_id: roomId, message_ids: [msg.id] });
          const isEmbed = new URLSearchParams(window.location.search).get('embed') === 'true';
          if (!isEmbed && localStorage.getItem('notificationSound') !== 'off') {
            new Audio('/notification.wav').play().catch(() => {});
          }
        }
      });

      socket.on('message:read', (data) => {
        if (data.read_counts) {
          Object.entries(data.read_counts).forEach(([id, count]) => {
            useMessageStore.getState().updateReadCount(id, count);
          });
        }
      });

      socket.on('voice:status', (data) => {
        useMessageStore.getState().updateTranscription(data.message_id, { status: data.status });
      });

      socket.on('voice:transcription', (data) => {
        // #216: version も含めて更新 (再文字起こしで v2+ になった時に履歴ボタンが出るように)
        useMessageStore.getState().updateTranscription(data.message_id, {
          status: data.status,
          raw_text: data.raw_text,
          formatted_text: data.formatted_text,
          ...(data.version !== undefined ? { version: data.version } : {}),
        });
      });

      socket.on('message:updated', (data) => {
        updateMessageContent(data.message_id, data.content, data.is_edited);
      });

      socket.on('message:published', (data) => {
        useMessageStore.getState().updatePublishStatus(data.message_id, data.is_published);
      });

      socket.on('message:deleted', (data) => {
        useMessageStore.getState().markDeleted(data.message_id);
      });

      socket.on('message:reaction', (data) => {
        useMessageStore.getState().updateReactions(data.message_id, data.reactions);
      });

      socket.on('link:preview', (data) => {
        useMessageStore.getState().updateLinkPreview(data.message_id, data.preview);
      });

      socket.on('typing:start', (data) => {
        if (data.user_id === user.id) return;
        setTypingUsers(prev => ({ ...prev, [data.user_id]: data.display_name }));
      });

      socket.on('typing:stop', (data) => {
        if (data.user_id === user.id) return;
        setTypingUsers(prev => {
          const next = { ...prev };
          delete next[data.user_id];
          return next;
        });
      });

      socket.on('agent:status', (data) => {
        if (data.room_id && data.room_id !== roomId) return; // 自分のルームのみ
        setAgentStatus(data.status === 'idle' ? null : data);
      });

      // #184 browser TTS: server からの tts:speak で Web Speech API で発声。
      // event が届いた = agent-server が browser TTS を意図 (primary mode or
      // rtc-server 不可時の dynamic degrade)。client 側 config は startup 時の
      // 静的値なので信頼せず、server の意図に従う。実発話 ON/OFF は speakAuto
      // 内部の ttsReadAloud 設定で gate される。
      socket.on('tts:speak', (data) => {
        if (data.room_id && data.room_id !== roomId) return;
        if (data.sender_id === user?.id) return;  // 自分が送ったテキストは読まない
        speakAuto(data.text);
      });

      // #189 aivis-cloud TTS: server が合成済 WAV の URL を Socket.IO 経由で配布。
      // mediasoup を経由しないので rtc-server 不要。
      // <audio> は Authorization header を送れないため、fetch で blob を取得して
      // blob URL 経由で再生 (JWT 認証を維持しつつ <audio> 制約を回避)。
      socket.on('tts:audio', async (data) => {
        if (data.room_id && data.room_id !== roomId) return;
        if (data.sender_id === user?.id) return;
        if (!data.url) return;
        if (localStorage.getItem('ttsReadAloud') !== 'on') return;

        try {
          const token = localStorage.getItem('token');
          const res = await fetch(data.url, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) {
            console.warn('[tts:audio] fetch failed:', res.status);
            return;
          }
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          // Web Audio API 経由で再生 (TTS_VOLUME_BOOST > 1.0 の boost を効かせる)
          playTtsSrc(blobUrl, {
            onEnded: () => URL.revokeObjectURL(blobUrl),
            onError: () => URL.revokeObjectURL(blobUrl),
          });
        } catch (err) {
          console.warn('[tts:audio] error:', err.message);
        }
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearCurrentRoom();
      clearMessages();
      if (socket) {
        socket.emit('room:leave', roomId);
        socket.off('message:new');
        socket.off('message:read');
        socket.off('voice:status');
        socket.off('voice:transcription');
        socket.off('message:updated');
        socket.off('message:published');
        socket.off('message:deleted');
        socket.off('typing:start');
        socket.off('typing:stop');
        socket.off('message:reaction');
        socket.off('link:preview');
        socket.off('tts:speak');
        socket.off('tts:audio');
        socket.off('agent:status');
        socket.off('connect');
      }
    };
  }, [roomId]);

  return { typingUsers, agentStatus };
}

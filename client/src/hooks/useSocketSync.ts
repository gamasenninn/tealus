import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { useMessageStore } from '../stores/messageStore';
import { getSocket } from '../services/socket';
import { api } from '../services/api';
import { speakAuto } from '../services/browserTts';
import { playTtsSrc } from '../services/ttsAudioPlayer';
import type { Message, Reaction, LinkPreview, Transcription } from '../types';

// --- Socket.IO event payload (client が消費するフィールドのみ最小型付け) ---

interface MessageReadPayload {
  read_counts?: Record<string, number>;
}

interface VoiceStatusPayload {
  message_id: string;
  status: Transcription['status'];
}

interface VoiceTranscriptionPayload {
  message_id: string;
  status: Transcription['status'];
  raw_text?: string | null;
  formatted_text?: string | null;
  version?: number;
}

interface MessageUpdatedPayload {
  message_id: string;
  content: string | null;
  is_edited: boolean;
}

interface MessagePublishedPayload {
  message_id: string;
  is_published: boolean;
}

interface MessageDeletedPayload {
  message_id: string;
}

interface MessageReactionPayload {
  message_id: string;
  reactions: Reaction[];
}

interface LinkPreviewPayload {
  message_id: string;
  preview: LinkPreview | null;
}

interface TypingPayload {
  room_id?: string;
  user_id: string;
  display_name: string;
}

export interface AgentStatusPayload {
  room_id?: string;
  agent_id: string;
  display_name?: string;
  status: string;
  message?: string;
}

interface TtsSpeakPayload {
  room_id?: string;
  sender_id?: string;
  text: string;
}

interface TtsAudioPayload {
  room_id?: string;
  sender_id?: string;
  url?: string;
}

export interface UseSocketSyncResult {
  /** user_id → display_name */
  typingUsers: Record<string, string>;
  agentStatus: AgentStatusPayload | null;
}

/**
 * Manages all Socket.IO event subscriptions for a chat room.
 * Also handles room initialization and cleanup.
 * Returns typingUsers state.
 */
export function useSocketSync(roomId: string, targetMsgId: string | null = null): UseSocketSyncResult {
  const { user } = useAuthStore();
  const { selectRoom, clearCurrentRoom } = useRoomStore();
  const { addMessage, fetchMessages, clearMessages, updateMessageContent } = useMessageStore();
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [agentStatus, setAgentStatus] = useState<AgentStatusPayload | null>(null);

  useEffect(() => {
    // room 切替時に前ルームの stale な状態をリセット (考え中/入力中が残り続ける bug 防止)。
    // socket は全所属 room に join しているため、別ルーム宛ての idle を取りこぼすと
    // agentStatus/typingUsers が消えないまま room 切替後も表示され続ける問題があった。
    setAgentStatus(null);
    setTypingUsers({});

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
    // #239: handler は const に extract して socket.off(event, handler) で specific 削除
    // (引数なし socket.off(event) は他 component の listener も巻き添え削除する。
    //  例: RoomList sidebar の message:new handler、PC layout で発覚した既存 bug)
    const handleConnect = () => {
      socket!.emit('room:join', roomId);
      // 再接続 = 切断中に idle / typing:stop を取りこぼした可能性がある。
      // 一過性の「考え中」/「入力中」は履歴に残らないので、ここでリセットしないと
      // スマホのスリープ復帰後に消えず残り続ける（議事録完成後も「考え中」のまま）。
      setAgentStatus(null);
      setTypingUsers({});
    };

    const handleMessageNew = (msg: Message) => {
      if (msg.room_id !== roomId) return; // 自分のルームのメッセージのみ処理
      addMessage(msg);
      // 考え中だった agent 自身の返信が届いたら「考え中」を解除 (idle 取りこぼしの保険、agent_id 一致のみ)
      setAgentStatus(prev => (prev && prev.agent_id === msg.sender_id ? null : prev));
      if (msg.sender_id !== user!.id) {
        api.markRead(roomId, [msg.id]).catch(() => {});
        socket!.emit('message:read', { room_id: roomId, message_ids: [msg.id] });
        const isEmbed = new URLSearchParams(window.location.search).get('embed') === 'true';
        if (!isEmbed && localStorage.getItem('notificationSound') !== 'off') {
          new Audio('/notification.wav').play().catch(() => {});
        }
      }
    };

    const handleMessageRead = (data: MessageReadPayload) => {
      if (data.read_counts) {
        Object.entries(data.read_counts).forEach(([id, count]) => {
          useMessageStore.getState().updateReadCount(id, count);
        });
      }
    };

    const handleVoiceStatus = (data: VoiceStatusPayload) => {
      useMessageStore.getState().updateTranscription(data.message_id, { status: data.status });
    };

    const handleVoiceTranscription = (data: VoiceTranscriptionPayload) => {
      // #216: version も含めて更新 (再文字起こしで v2+ になった時に履歴ボタンが出るように)
      useMessageStore.getState().updateTranscription(data.message_id, {
        status: data.status,
        raw_text: data.raw_text,
        formatted_text: data.formatted_text,
        ...(data.version !== undefined ? { version: data.version } : {}),
      });
    };

    const handleMessageUpdated = (data: MessageUpdatedPayload) => {
      updateMessageContent(data.message_id, data.content, data.is_edited);
    };

    const handleMessagePublished = (data: MessagePublishedPayload) => {
      useMessageStore.getState().updatePublishStatus(data.message_id, data.is_published);
    };

    const handleMessageDeleted = (data: MessageDeletedPayload) => {
      useMessageStore.getState().markDeleted(data.message_id);
    };

    const handleMessageReaction = (data: MessageReactionPayload) => {
      useMessageStore.getState().updateReactions(data.message_id, data.reactions);
    };

    const handleLinkPreview = (data: LinkPreviewPayload) => {
      useMessageStore.getState().updateLinkPreview(data.message_id, data.preview);
    };

    const handleTypingStart = (data: TypingPayload) => {
      if (data.room_id && data.room_id !== roomId) return; // 他ルームの入力中は表示しない (socket は全所属 room に join しているため)
      if (data.user_id === user!.id) return;
      setTypingUsers(prev => ({ ...prev, [data.user_id]: data.display_name }));
    };

    const handleTypingStop = (data: TypingPayload) => {
      if (data.room_id && data.room_id !== roomId) return;
      if (data.user_id === user!.id) return;
      setTypingUsers(prev => {
        const next = { ...prev };
        delete next[data.user_id];
        return next;
      });
    };

    const handleAgentStatus = (data: AgentStatusPayload) => {
      if (data.room_id && data.room_id !== roomId) return; // 自分のルームのみ
      setAgentStatus(data.status === 'idle' ? null : data);
    };

    // #184 browser TTS: server からの tts:speak で Web Speech API で発声。
    // event が届いた = agent-server が browser TTS を意図 (primary mode or
    // rtc-server 不可時の dynamic degrade)。client 側 config は startup 時の
    // 静的値なので信頼せず、server の意図に従う。実発話 ON/OFF は speakAuto
    // 内部の ttsReadAloud 設定で gate される。
    const handleTtsSpeak = (data: TtsSpeakPayload) => {
      if (data.room_id && data.room_id !== roomId) return;
      if (data.sender_id === user?.id) return;  // 自分が送ったテキストは読まない
      speakAuto(data.text);
    };

    // #189 aivis-cloud TTS: server が合成済 WAV の URL を Socket.IO 経由で配布。
    // mediasoup を経由しないので rtc-server 不要。
    // <audio> は Authorization header を送れないため、fetch で blob を取得して
    // blob URL 経由で再生 (JWT 認証を維持しつつ <audio> 制約を回避)。
    const handleTtsAudio = async (data: TtsAudioPayload) => {
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
        console.warn('[tts:audio] error:', err instanceof Error ? err.message : String(err));
      }
    };

    if (socket) {
      socket.emit('room:join', roomId);
      socket.on('connect', handleConnect);
      socket.on('message:new', handleMessageNew);
      socket.on('message:read', handleMessageRead);
      socket.on('voice:status', handleVoiceStatus);
      socket.on('voice:transcription', handleVoiceTranscription);
      socket.on('message:updated', handleMessageUpdated);
      socket.on('message:published', handleMessagePublished);
      socket.on('message:deleted', handleMessageDeleted);
      socket.on('message:reaction', handleMessageReaction);
      socket.on('link:preview', handleLinkPreview);
      socket.on('typing:start', handleTypingStart);
      socket.on('typing:stop', handleTypingStop);
      socket.on('agent:status', handleAgentStatus);
      socket.on('tts:speak', handleTtsSpeak);
      socket.on('tts:audio', handleTtsAudio);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearCurrentRoom();
      clearMessages();
      if (socket) {
        socket.emit('room:leave', roomId);
        // #239: handler reference を passed して specific 削除 (他 listener 影響なし)
        socket.off('connect', handleConnect);
        socket.off('message:new', handleMessageNew);
        socket.off('message:read', handleMessageRead);
        socket.off('voice:status', handleVoiceStatus);
        socket.off('voice:transcription', handleVoiceTranscription);
        socket.off('message:updated', handleMessageUpdated);
        socket.off('message:published', handleMessagePublished);
        socket.off('message:deleted', handleMessageDeleted);
        socket.off('message:reaction', handleMessageReaction);
        socket.off('link:preview', handleLinkPreview);
        socket.off('typing:start', handleTypingStart);
        socket.off('typing:stop', handleTypingStop);
        socket.off('agent:status', handleAgentStatus);
        socket.off('tts:speak', handleTtsSpeak);
        socket.off('tts:audio', handleTtsAudio);
      }
    };
  }, [roomId]);

  return { typingUsers, agentStatus };
}

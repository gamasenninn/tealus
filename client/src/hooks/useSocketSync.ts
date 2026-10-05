import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { useMessageStore } from '../stores/messageStore';
import { getSocket, joinRoom, leaveRoom } from '../services/socket';
import { api } from '../services/api';
import { speakAuto } from '../services/browserTts';
import { playTtsSrc } from '../services/ttsAudioPlayer';
import { isAudioHeld } from '../utils/audioExclusive';
import { withMe } from '../utils/reactionMe';
import type { Message, MessageTag, Reaction, LinkPreview, Transcription } from '../types';

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

    // #474 画面が裏にある間に届いた投稿は既読にせず溜めておき、戻ったときにまとめて既読にする。
    //   以前は開いたままの端末が裏でも既読にしていた (既読は人ごとに 1 つなので、他の端末に未読の数が出ない)
    let pendingReadIds: string[] = [];
    const markRead = (ids: string[]) => {
      api.markRead(roomId, ids).catch(() => {});
      getSocket()?.emit('message:read', { room_id: roomId, message_ids: ids });
    };

    // #475 部屋を開いていて画面が見えている間だけ「見ている」を知らせる。
    //   サーバーは、その部屋を見ている人を通知の送り先から外す (以前は接続しているだけで外していたので、
    //   PC を開いたままだとスマホに通知が届かなかった)
    const sendViewing = (viewing: boolean) => {
      getSocket()?.emit('room:viewing', { room_id: roomId, viewing });
    };
    if (document.visibilityState === 'visible') sendViewing(true);

    // Re-fetch messages when app returns from background
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        sendViewing(true);
        if (pendingReadIds.length > 0) {
          markRead(pendingReadIds);
          pendingReadIds = [];
        }
        fetchMessages(roomId);
      } else {
        sendViewing(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const socket = getSocket();
    // #239: handler は const に extract して socket.off(event, handler) で specific 削除
    // (引数なし socket.off(event) は他 component の listener も巻き添え削除する。
    //  例: RoomList sidebar の message:new handler、PC layout で発覚した既存 bug)
    const handleConnect = () => {
      socket!.emit('room:join', roomId);
      // #475 サーバーは切断で「見ている」を忘れるので、見えていれば知らせ直す
      if (document.visibilityState === 'visible') sendViewing(true);
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
        if (document.visibilityState === 'visible') markRead([msg.id]);
        else pendingReadIds.push(msg.id);
        // ★ #505 新着の音はここでは鳴らさない。一覧 (RoomList) が iframe の中以外ではいつも動いていて、
        //   開いている部屋の新着でも鳴らす。ここでも鳴らしていたので 1 件で 2 回鳴っていた
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
      // ★ #488 me は自分の ID で決める (配られる me は付けた本人の目線だったので信じない)
      useMessageStore.getState().updateReactions(data.message_id, withMe(data.reactions, user?.id));
    };

    // ★ #496 タグの変化。それまで知らせが無く、相手の画面は読み込み直すまで古いままだった
    const handleMessageTags = (data: { message_id: string; tags: MessageTag[] }) => {
      useMessageStore.getState().updateTags(data.message_id, data.tags);
    };
    const handleRoomTagDeleted = (data: { tag_id: string }) => {
      useMessageStore.getState().removeTag(data.tag_id);
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
      // ★ 会話モードが音声を掴んでいる間は読み上げない (#413)。重なると会話にならない。
      //   飛ばしてもメッセージ自体はルームに残るので、失われるものは無い。
      if (isAudioHeld()) return;
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
      // ★ 会話モードが掴んでいる間は始めない (#413)。**取りに行きもしない** (無駄な取得をしない)
      if (isAudioHeld()) return;

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
      joinRoom(roomId);   // ★ #505 出入りは窓口で数える (一覧も同じ部屋に入っている)
      socket.on('connect', handleConnect);
      socket.on('message:new', handleMessageNew);
      socket.on('message:read', handleMessageRead);
      socket.on('voice:status', handleVoiceStatus);
      socket.on('voice:transcription', handleVoiceTranscription);
      socket.on('message:updated', handleMessageUpdated);
      socket.on('message:published', handleMessagePublished);
      socket.on('message:deleted', handleMessageDeleted);
      socket.on('message:reaction', handleMessageReaction);
      socket.on('message:tags', handleMessageTags);
      socket.on('room:tag_deleted', handleRoomTagDeleted);
      socket.on('link:preview', handleLinkPreview);
      socket.on('typing:start', handleTypingStart);
      socket.on('typing:stop', handleTypingStop);
      socket.on('agent:status', handleAgentStatus);
      socket.on('tts:speak', handleTtsSpeak);
      socket.on('tts:audio', handleTtsAudio);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      sendViewing(false);   // #475 部屋を離れたら「見ていない」
      clearCurrentRoom();
      clearMessages();
      if (socket) {
        // ★ #505 room:leave を直接送らない。送ると一覧ごとこの部屋から抜け、読み込み直すまで
        //   一覧に新着 (音・未読・最後の投稿) が届かなかった。窓口が数えて、最後の 1 つのときだけ抜ける
        leaveRoom(roomId);
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
        socket.off('message:tags', handleMessageTags);
        socket.off('room:tag_deleted', handleRoomTagDeleted);
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

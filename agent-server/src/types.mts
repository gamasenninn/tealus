/**
 * agent-server 共有型 (#330 TS 移行で導入)
 * server の webhook payload に対応する。消費するフィールドのみ載せる。
 */

export interface WebhookSender {
  id?: string;
  display_name?: string;
}

export interface WebhookMessage {
  id?: string;
  type?: string;
  content?: string | null;
  created_at?: string;
  reply_to?: string | null;
  reply_to_message?: {
    content?: string | null;
    sender_display_name?: string;
  } | null;
  sender?: WebhookSender;
  transcription?: WebhookTranscription | null;
  /** media 系 message の添付 (media/messageAdapter が消費) */
  media?: Array<{ file_path?: string; mime_type?: string; file_name?: string | null }>;
  /** message.updated イベント: 編集前の本文 (#338 Phase 2 編集トリガーが消費) */
  previous_content?: string | null;
  /** message.updated イベント: 編集者 */
  edited_by?: { id?: string; display_name?: string };
}

export interface WebhookRoom {
  id: string;
  name?: string | null;
  member_count?: number;
}

export interface WebhookTranscription {
  formatted_text?: string | null;
  raw_text?: string | null;
  status?: string;
}

export interface WebhookPayload {
  event?: string;
  message?: WebhookMessage;
  room?: WebhookRoom;
  transcription?: WebhookTranscription;
  member?: { id?: string; user_id?: string };
  reaction?: { emoji?: string };
}

/** dispatch() の引数 */
export interface DispatchParams {
  message: WebhookMessage;
  room: WebhookRoom;
  agentId: string | null;
  agentName: string | null;
}

/**
 * client 共有ドメイン型 (#330 TS 移行で導入)
 *
 * server の API 応答形に対応する。全列を網羅するのではなく「client が実際に
 * 消費するフィールド」を型に載せる方針。未知のフィールドが必要になったら
 * ここに optional で追加する (index signature で逃げない)。
 */

export type UserRole = 'admin' | 'user' | 'guest';

export interface User {
  id: string;
  login_id: string;
  display_name: string;
  avatar_url: string | null;
  status_message?: string | null;
  role: UserRole;
  is_active?: boolean;
  is_bot?: boolean;
  created_at?: string;
}

export type RoomType = 'group' | 'direct';

export interface Room {
  id: string;
  type: RoomType;
  name: string | null;
  icon_url?: string | null;
  created_by?: string;
  partner_id?: string;
  partner_display_name?: string | null;
  partner_avatar_url?: string | null;
  member_count?: number;
  unread_count?: number;
  last_message?: string | null;
  last_message_type?: string | null;
  last_message_at?: string | null;
  message_edit_policy?: 'none' | 'sender' | 'member';
  is_announcement?: boolean;
  my_role?: string;
}

export interface RoomMember extends User {
  room_role?: string;
  joined_at?: string;
}

export type MessageType = 'text' | 'image' | 'video' | 'file' | 'voice' | 'system' | 'stamp';

export interface Transcription {
  status: 'pending' | 'processing' | 'done' | 'error';
  raw_text?: string | null;
  formatted_text?: string | null;
  version?: number;
  edited_by?: string | null;
}

export interface MediaItem {
  id: string;
  url: string;
  mime_type: string;
  file_name?: string | null;
  file_size?: string | number | null;
  thumbnail_url?: string | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  users?: Array<{ id: string; display_name: string }>;
  reacted?: boolean;
}

export interface MessageTag {
  tag_id: string;
  name: string;
  is_todo?: boolean;
  is_done?: boolean | null;
  priority?: number | null;
}

export interface QuotedMessage {
  id: string;
  content: string | null;
  type: string;
  sender_id: string;
  sender_display_name: string;
  room_name?: string | null;
  is_deleted?: boolean;
}

export interface Message {
  id: string;
  room_id: string;
  sender_id: string;
  content: string | null;
  type: MessageType | string;
  created_at: string;
  updated_at?: string;
  is_deleted?: boolean;
  is_edited?: boolean;
  is_published?: boolean;
  reply_to?: string | null;
  forwarded_from?: string | null;
  sender_display_name?: string;
  sender_avatar_url?: string | null;
  media?: MediaItem[];
  reactions?: Reaction[];
  read_count?: number;
  transcription?: Transcription | null;
  reply_to_message?: QuotedMessage | null;
  forwarded_from_message?: QuotedMessage | null;
  tags?: MessageTag[];
  link_previews?: LinkPreview[];
}

export interface LinkPreview {
  url: string;
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  is_todo: boolean;
  room_id?: string;
  usage_count?: number;
}

export interface Stamp {
  id: string;
  pack_id: string;
  image_url: string;
  label?: string | null;
}

export interface StampPack {
  id: string;
  name: string;
  created_by?: string;
  stamps?: Stamp[];
}

export interface PortalLink {
  id: string;
  title: string;
  url: string;
  icon?: string | null;
  sort_order?: number;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  room_id?: string | null;
  secret?: string | null;
  is_active?: boolean;
}

export interface DictionaryTerm {
  id: string;
  term: string;
  reading: string | null;
  category?: string | null;
  source?: string;
  status?: string;
}

export interface DictionaryAlias {
  id: string;
  term_id?: string;
  term?: string;
  alias: string;
  status: string;
  confidence?: string | null;
  occurrence_count?: number;
}

export interface ClientConfig {
  realtime_voice_available?: boolean;
  [key: string]: unknown;
}

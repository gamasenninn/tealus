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
  /** RoomList のプレビューが消費する実応答フィールド */
  last_message_content?: string | null;
  last_message_type?: string | null;
  last_message_at?: string | null;
  message_edit_policy?: 'none' | 'sender' | 'member';
  allow_member_transcription_edit?: boolean;
  app_urls?: AppUrl[];
  is_announcement?: boolean;
  my_role?: string;
}

export interface RoomMember extends User {
  /** server の members 応答は id と user_id の両方を持つ */
  user_id?: string;
  room_role?: string;
  joined_at?: string;
}

/** ルームに紐づく外部アプリ URL (useAppPanel / ChatRoom が消費) */
export interface AppUrl {
  url: string;
  title?: string;
  auto_open?: boolean;
  wake_lock?: boolean;
  ratio?: number;
}

export type MessageType = 'text' | 'image' | 'video' | 'file' | 'voice' | 'system' | 'stamp';

export interface Transcription {
  status: 'pending' | 'processing' | 'transcribing' | 'formatting' | 'done' | 'error';
  raw_text?: string | null;
  formatted_text?: string | null;
  version?: number;
  edited_by?: string | null;
}

export interface MediaItem {
  id: string;
  url?: string;
  /** server 実応答は file_path / thumbnail_path (gallery / bubble 系が消費) */
  file_path?: string;
  thumbnail_path?: string | null;
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
  /** server は me という名でも返す (MessageBubble が消費) */
  me?: boolean;
}

export interface MessageTag {
  id?: string;
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
  /** socket 'link:preview' event で注入される単数形 (messageStore / MessageBubble が消費) */
  link_preview?: LinkPreview | null;
  /** お知らせ API (#announcements) */
  is_unread?: boolean;
  /** 検索結果で付与される (SearchPage が消費) */
  room_name?: string | null;
  tag_id?: string;
  is_done?: boolean | null;
  priority?: number | null;
  /** type='stamp' の展開済みスタンプ (MessageBubble が消費) */
  stamp?: { file_path: string; label?: string | null } | null;
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
  total_usage?: number;
}

export interface Stamp {
  id: string;
  pack_id: string;
  image_url?: string;
  file_path?: string;
  label?: string | null;
}

export interface StampPack {
  id: string;
  name: string;
  created_by?: string;
  thumbnail_path?: string | null;
  stamps?: Stamp[];
}

export interface PortalLink {
  id: string;
  title: string;
  url: string;
  icon?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  room_id?: string | null;
  room_name?: string | null;
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
  description?: string | null;
  alias_count?: number;
}

export interface DictionaryAlias {
  id?: string;
  alias_id?: string;
  term_id?: string;
  term?: string;
  alias: string;
  status?: string;
  source?: string;
  reading?: string | null;
  confidence?: string | null;
  occurrence_count?: number;
  count?: number;
}

export interface ClientConfig {
  realtime_voice_available?: boolean;
  [key: string]: unknown;
}

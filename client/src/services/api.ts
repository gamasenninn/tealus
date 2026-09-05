import type {
  User, Room, RoomMember, Message, Tag, MessageTag, StampPack, Stamp, MediaItem,
  PortalLink, Webhook, DictionaryTerm, DictionaryAlias,
} from '../types';

const API_BASE = '/api';

// #322: transport 層の間欠失敗（Cloudflare↔オリジン↔回線のストール）に対する client 耐性。
// GET のみ transient 失敗を限定リトライ + 全 method にタイムアウト。POST/PUT/DELETE は
// 二重送信回避のためリトライしない。
const RETRY_STATUS = new Set([408, 429, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withJitter = (ms: number) => ms + Math.floor(Math.random() * 150);

type Json = Record<string, unknown>;

// --- API 応答形 (client が消費するフィールドのみ。詳細は ../types) ---
export interface AuthResponse { token: string; user: User; error?: string }
export interface MeResponse { user: User }
export interface RoomsResponse { rooms: Room[] }
export interface RoomResponse { room: Room; members: RoomMember[]; last_read_message_id?: string | null }
export interface MessagesResponse { messages: Message[]; has_more?: boolean }
export interface MessageResponse { message: Message }
export interface UsersResponse { users: User[] }
export interface OnlineUsersResponse { online: string[] }
export interface TagsResponse { tags: Tag[] }
export interface MessageTagsResponse { tags: MessageTag[] }
export interface SearchResponse { results: Message[]; total?: number; has_more?: boolean }
export interface StampPacksResponse { packs: StampPack[] }
export interface StampPackResponse { pack: StampPack; stamps: Stamp[] }
export interface MediaGalleryResponse { media: Array<MediaItem & { message_created_at?: string; sender_id?: string; sender_display_name?: string }>; has_more?: boolean; total?: number }
export interface PortalLinksResponse { links: PortalLink[] }
export interface WebhooksResponse { webhooks: Webhook[] }
export interface DictionaryAliasesResponse { aliases: DictionaryAlias[] }
export interface DictionaryTermsResponse { terms: DictionaryTerm[] }
export interface TranscriptionHistoryResponse { history: Array<{ version: number; formatted_text?: string | null; raw_text?: string | null; edited_by_name?: string | null }> }
export interface TranscriptionEditResponse { transcription: { formatted_text?: string | null; version?: number } }
export interface CcProjectsResponse { projects: Array<{ name: string; [key: string]: unknown }> }
/**
 * #354 エージェント指示の履歴。content は宛先込みの全文（表示 = 入力欄に入る文字列）。
 * #358 holes は「履歴の中で実際に変動した」数字の位置（content 上のオフセット）。
 * 変動の証拠がない数字は穴にしない（推測すると 2026年 の 2026 を壊す）。
 */
export interface PromptHistoryItem {
  message_id: string; target: string; body: string; content: string;
  holes: Array<{ start: number; end: number }>;
  created_at: string;
}
export interface PromptHistoryResponse { items: PromptHistoryItem[]; target_counts: Record<string, number> }
export interface AgentIdentityResponse { user_id: string | null; display_name: string | null }
/** #356 配信中クライアントのビルド ID。未ビルド (dev) では null */
export interface VersionResponse { build_id: string | null }

export type UploadProgressHandler = (percent: number) => void;

class ApiClient {
  token: string | null;
  requestTimeoutMs: number;
  retryBackoffMs: number[];

  constructor() {
    this.token = localStorage.getItem('token');
    // #322 リトライ/タイムアウト設定（テストで上書き可能）
    this.requestTimeoutMs = 10000;
    this.retryBackoffMs = [300, 800]; // GET transient retry の待ち時間（length = 最大リトライ回数）
  }

  /**
   * Common file upload via XHR with progress support
   */
  _upload<T = Json>(url: string, formData: FormData, onProgress?: UploadProgressHandler): Promise<T> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        const data = JSON.parse(xhr.responseText) as T & { error?: string };
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data.error || 'アップロードに失敗しました'));
        }
      };

      xhr.onerror = () => reject(new Error('アップロードに失敗しました'));
      xhr.send(formData);
    });
  }

  setToken(token: string | null): void {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  async request<T = Json>(method: string, path: string, body: unknown = null): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const opts: RequestInit = { method, headers };
    if (body) {
      opts.body = JSON.stringify(body);
    }

    // GET のみ transient 失敗をリトライ（非冪等 method は二重送信回避で 1 回のみ実行）。
    const isGet = method === 'GET';
    const maxAttempts = isGet ? this.retryBackoffMs.length + 1 : 1;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const backoff = withJitter(this.retryBackoffMs[attempt - 1]);
        // 無言で握り潰さない: リトライ痕跡を残し、根本（transport）悪化の検知材料にする。
        console.warn(`[api] ${method} ${path} transient 失敗、リトライ ${attempt}/${maxAttempts - 1}（${Math.round(backoff)}ms 待機）: ${lastError?.message || lastError}`);
        await sleep(backoff);
      }

      // 全 method に AbortController でタイムアウトを付与（従来は無限待ちだった）。
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const res = await fetch(`${API_BASE}${path}`, { ...opts, signal: controller.signal });

        let data: (T & { error?: string }) | undefined;
        try {
          data = await res.json();
        } catch {
          // 非JSON応答（プロキシの HTML エラーページ等）。GET の transient status のみリトライ。
          if (isGet && RETRY_STATUS.has(res.status)) {
            lastError = new Error(`非JSON応答 (status ${res.status})`);
            continue;
          }
          throw new Error(res.ok ? '応答の解析に失敗しました' : `リクエストに失敗しました (${res.status})`);
        }

        if (!res.ok) {
          if (isGet && RETRY_STATUS.has(res.status)) {
            lastError = new Error(data?.error || `status ${res.status}`);
            continue;
          }
          throw new Error(data?.error || 'リクエストに失敗しました');
        }
        return data as T;
      } catch (err) {
        // ネットワーク断（TypeError）/ タイムアウト（AbortError）は GET のみ transient 扱い。
        const isTransient = (err instanceof Error && err.name === 'AbortError') || err instanceof TypeError;
        if (isGet && isTransient) {
          lastError = (err as Error).name === 'AbortError' ? new Error(`タイムアウト (${this.requestTimeoutMs}ms)`) : (err as Error);
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('リクエストに失敗しました');
  }

  // Auth
  login(login_id: string, password: string) {
    return this.request<AuthResponse>('POST', '/auth/login', { login_id, password });
  }

  register(login_id: string, display_name: string, password: string) {
    return this.request<AuthResponse>('POST', '/auth/register', { login_id, display_name, password });
  }

  getMe() {
    return this.request<MeResponse>('GET', '/auth/me');
  }

  // Rooms
  getRooms() {
    return this.request<RoomsResponse>('GET', '/rooms');
  }

  getRoom(roomId: string) {
    return this.request<RoomResponse>('GET', `/rooms/${roomId}`);
  }

  createGroup(name: string, memberIds: string[]) {
    return this.request<{ room: Room }>('POST', '/rooms', { name, member_ids: memberIds });
  }

  createDirect(partnerId: string) {
    return this.request<{ room: Room }>('POST', '/rooms/direct', { partner_id: partnerId });
  }

  // Messages
  getMessages(roomId: string, before: string | null = null, limit = 20, around: string | null = null) {
    let url = `/rooms/${roomId}/messages?limit=${limit}`;
    if (around) url += `&around=${around}`;
    else if (before) url += `&before=${before}`;
    return this.request<MessagesResponse>('GET', url);
  }

  sendMessage(roomId: string, content: string, replyTo: string | null = null, forwardedFrom: string | null = null) {
    return this.request<MessageResponse>('POST', `/rooms/${roomId}/messages`, {
      content,
      reply_to: replyTo,
      forwarded_from: forwardedFrom,
    });
  }

  forwardMedia(targetRoomId: string, sourceMessageId: string) {
    return this.request<MessageResponse>('POST', `/rooms/${targetRoomId}/media/forward`, {
      source_message_id: sourceMessageId,
    });
  }

  /**
   * #356 いま配信されているクライアントのビルド ID。
   * Service Worker の precache を通らない経路なので、SW が古い画面を出していても真実が取れる。
   */
  getVersion(): Promise<VersionResponse> {
    return this.request<VersionResponse>('GET', '/version');
  }

  /**
   * #354 このルームで自分が送った「@宛先 + 本文」形式の過去メッセージを新しい順に取得。
   * cc project 一覧は agent-server 側にあり本体 server は知らないため、宛先は client から渡す。
   */
  getPromptHistory(roomId: string, targets: string[], limit = 30): Promise<PromptHistoryResponse> {
    const q = new URLSearchParams({ targets: targets.join(','), limit: String(limit) });
    return this.request<PromptHistoryResponse>('GET', `/rooms/${roomId}/prompts/history?${q}`);
  }

  /**
   * cc-queue から登録済 project 一覧を取得 (#253)
   * mention picker の virtual user 候補に使う。
   */
  getCcProjects(): Promise<CcProjectsResponse> {
    return this._agentApi<CcProjectsResponse>('GET', '/agent/cc-projects', undefined, { fallback: { projects: [] } });
  }

  /**
   * アプリ内アシスタントの identity を取得 (#338 Phase 1)
   * 「エージェントに送る」compose ヘルパーが正しい宛先メンションを組むのに使う。失敗時は null identity。
   */
  getAgentIdentity(): Promise<AgentIdentityResponse> {
    return this._agentApi<AgentIdentityResponse>('GET', '/agent/identity', undefined, { fallback: { user_id: null, display_name: null } });
  }

  /**
   * Deep agent の処理を中断 (#250)
   */
  cancelAgent(roomId: string): Promise<Json> {
    return this._agentApi('POST', '/agent/cancel', { room_id: roomId }, { errorMessage: '中断リクエストに失敗しました' });
  }

  /**
   * TTS synthesis (personal read-aloud) — returns Blob (audio/wav)
   * Uses room's TTS model setting. Safe to call from any component.
   */
  synthesizeTts(text: string, roomId: string): Promise<Blob> {
    return this._agentApi<Blob>('POST', '/tts/synthesize', { text, room_id: roomId }, { as: 'blob', errorMessage: 'TTS に失敗しました' });
  }

  // === #405 Realtime 音声会話 (docs/08 §12) — agent-server /voice-chat/... proxy 経由 ===

  /** 会話を始める。★ MCP の冷間起動をここで吸収するので、数十秒かかることがある */
  createVoiceChatSession(roomId: string): Promise<{ session_id: string; client_secret: string; model: string }> {
    return this._agentApi('POST', '/voice-chat/session', { room_id: roomId }, { errorMessage: '会話を開始できませんでした' });
  }

  /** モデルが要求した道具を、サーバ側で実行して結果をもらう (ブラウザは実行しない) */
  voiceChatToolCall(sessionId: string, callId: string, name: string, args: string): Promise<{ output: string; elapsed_ms: number }> {
    return this._agentApi('POST', '/voice-chat/tool-call', { session_id: sessionId, call_id: callId, name, arguments: args });
  }

  /**
   * ★ 昇格 — 会話の「良かった 1 つ」を、いま居るルームへ残す (docs/08 §1.2.2 / R3)。
   * ★ 行き先は渡さない。session のルームが唯一の正 (サーバ側で決まる)。
   * ★★ 失敗は握りつぶさない —— 残ったと思って残っていない、を作らないため。
   */
  voiceChatPromote(sessionId: string, text: string): Promise<{ ok: boolean }> {
    return this._agentApi('POST', '/voice-chat/promote', { session_id: sessionId, text }, { errorMessage: '残せませんでした' });
  }

  /** 計測イベントの送信 (docs/08 §12.6)。★ 失敗しても会話は止めない */
  voiceChatLog(sessionId: string, events: unknown[]): Promise<{ ok: boolean }> {
    return this._agentApi('POST', '/voice-chat/log', { session_id: sessionId, events }, { fallback: { ok: false } });
  }

  // === Room agent settings (#156) — agent-server /config/room/:roomId/... proxy 経由 ===
  async _agentApi<T = Json>(
    method: string,
    path: string,
    body?: unknown,
    extra: { as?: 'json' | 'blob'; fallback?: T; errorMessage?: string } = {},
  ): Promise<T> {
    const { as = 'json', fallback, errorMessage = 'agent-server リクエストに失敗しました' } = extra;
    try {
      const opts: RequestInit & { headers: Record<string, string> } = {
        method,
        headers: { Authorization: `Bearer ${this.token}` },
      };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(`/agent-api${path}`, opts);
      if (!res.ok) {
        if (fallback !== undefined) return fallback;
        let err = errorMessage;
        try { const j = await res.json() as { error?: string }; err = j.error || err; } catch {}
        throw new Error(err);
      }
      return (as === 'blob' ? await res.blob() : await res.json()) as T;
    } catch (e) {
      // fallback 指定メソッド (getCcProjects/getAgentIdentity) は失敗を silent に飲む
      if (fallback !== undefined) return fallback;
      throw e;
    }
  }

  getRoomAgentSettings(roomId: string) {
    return this._agentApi('GET', `/config/room/${roomId}/settings`);
  }

  updateRoomAgentSettings(roomId: string, settings: unknown) {
    return this._agentApi('PUT', `/config/room/${roomId}/settings`, { settings });
  }

  getRoomLightPrompt(roomId: string) {
    return this._agentApi<{ content?: string }>('GET', `/config/room/${roomId}/light-prompt`);
  }

  updateRoomLightPrompt(roomId: string, content: string) {
    return this._agentApi('PUT', `/config/room/${roomId}/light-prompt`, { content });
  }

  getRoomClaudeMd(roomId: string) {
    return this._agentApi<{ content?: string }>('GET', `/config/room/${roomId}/claude-md`);
  }

  updateRoomClaudeMd(roomId: string, content: string) {
    return this._agentApi('PUT', `/config/room/${roomId}/claude-md`, { content });
  }

  // Media (single file or array of files)
  uploadMedia(roomId: string, files: File | File[], onProgress?: UploadProgressHandler) {
    const formData = new FormData();
    const fileArray = Array.isArray(files) ? files : [files];
    for (const file of fileArray) {
      formData.append('files', file);
    }
    return this._upload<{ messages?: Message[]; message?: Message }>(`${API_BASE}/rooms/${roomId}/media`, formData, onProgress);
  }

  // Read
  markRead(roomId: string, messageIds: string[]) {
    return this.request('POST', `/rooms/${roomId}/read`, { message_ids: messageIds });
  }

  // Users
  getUsers() {
    return this.request<UsersResponse>('GET', '/users');
  }

  getOnlineUsers() {
    return this.request<OnlineUsersResponse>('GET', '/users/online');
  }

  // Push
  subscribePush(subscription: unknown) {
    return this.request('POST', '/push/subscribe', subscription);
  }

  unsubscribePush(endpoint: string) {
    return this.request('DELETE', '/push/subscribe', { endpoint });
  }

  // Room edit
  updateRoom(roomId: string, data: Partial<Room>) {
    return this.request<{ room: Room }>('PUT', `/rooms/${roomId}`, data);
  }

  uploadRoomIcon(roomId: string, file: File) {
    const formData = new FormData();
    formData.append('icon', file);
    return this._upload<{ room?: Room; icon_url?: string }>(`${API_BASE}/rooms/${roomId}/icon`, formData);
  }

  // Search
  search(q: string, { roomId, tagId, tagNames, isDone, sort, offset = 0 }: {
    roomId?: string; tagId?: string; tagNames?: string[];
    isDone?: string | boolean; sort?: string; offset?: number;
  } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (roomId) params.set('room_id', roomId);
    if (tagId) params.set('tag_id', tagId);
    if (tagNames && tagNames.length > 0) params.set('tag_names', tagNames.join(','));
    if (isDone !== undefined && isDone !== '') params.set('is_done', String(isDone));
    if (sort) params.set('sort', sort);
    params.set('offset', String(offset));
    return this.request<SearchResponse>('GET', `/search?${params}`);
  }

  // Reactions
  toggleReaction(roomId: string, messageId: string, emoji: string) {
    return this.request('POST', `/rooms/${roomId}/messages/${messageId}/reactions`, { emoji });
  }

  // Messages
  deleteMessage(roomId: string, messageId: string) {
    return this.request('DELETE', `/rooms/${roomId}/messages/${messageId}`);
  }

  // Members
  addMember(roomId: string, userId: string) {
    return this.request('POST', `/rooms/${roomId}/members`, { user_id: userId });
  }

  leaveRoom(roomId: string) {
    return this.request('DELETE', `/rooms/${roomId}/members/me`);
  }

  kickMember(roomId: string, userId: string) {
    return this.request('DELETE', `/rooms/${roomId}/members/${userId}`);
  }

  changeMemberRole(roomId: string, userId: string, role: string) {
    return this.request('PUT', `/rooms/${roomId}/members/${userId}/role`, { role });
  }

  // Voice
  uploadVoice(roomId: string, blob: Blob, onProgress?: UploadProgressHandler, replyTo?: string | null) {
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const formData = new FormData();
    if (replyTo) formData.append('reply_to', replyTo);
    formData.append('voice', blob, `voice.${ext}`);
    return this._upload<MessageResponse>(`${API_BASE}/rooms/${roomId}/voice`, formData, onProgress);
  }

  // Transcription
  editTranscription(messageId: string, text: string) {
    return this.request<TranscriptionEditResponse>('PUT', `/messages/${messageId}/transcription`, { text });
  }

  getTranscriptionHistory(messageId: string) {
    return this.request<TranscriptionHistoryResponse>('GET', `/messages/${messageId}/transcription/history`);
  }

  // #216: voice transcription 再実行 (新 version で Whisper + AI 整形を再実行)
  retranscribeVoiceMessage(messageId: string) {
    return this.request('POST', `/messages/${messageId}/transcription/retranscribe`);
  }

  // Profile
  updateProfile(data: Partial<User>) {
    return this.request<MeResponse>('PUT', '/auth/profile', data);
  }

  uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append('avatar', file);
    return this._upload<{ user?: User; avatar_url?: string }>(`${API_BASE}/auth/avatar`, formData);
  }

  changePassword(current_password: string, new_password: string) {
    return this.request('PUT', '/auth/password', { current_password, new_password });
  }

  // Tags
  getRoomTags(roomId: string) {
    return this.request<TagsResponse>('GET', `/rooms/${roomId}/tags`);
  }

  suggestTags(roomId: string, query: string) {
    return this.request<TagsResponse>('GET', `/rooms/${roomId}/tags/suggest?q=${encodeURIComponent(query)}`);
  }

  createTag(roomId: string, name: string, is_todo = false) {
    return this.request<{ tag: Tag }>('POST', `/rooms/${roomId}/tags`, { name, is_todo });
  }

  // ルームからタグを削除（付与済みメッセージからも FK カスケードで外れる）
  deleteRoomTag(roomId: string, tagId: string) {
    return this.request('DELETE', `/rooms/${roomId}/tags/${tagId}`);
  }

  getMessageTags(messageId: string) {
    return this.request<MessageTagsResponse>('GET', `/messages/${messageId}/tags`);
  }

  addMessageTag(messageId: string, { tag_id, name }: { tag_id?: string; name?: string }) {
    return this.request('POST', `/messages/${messageId}/tags`, tag_id ? { tag_id } : { name });
  }

  removeMessageTag(messageId: string, tagId: string) {
    return this.request('DELETE', `/messages/${messageId}/tags/${tagId}`);
  }

  updateMessageTag(messageId: string, tagId: string, data: { is_done?: boolean; priority?: number | null }) {
    return this.request('PATCH', `/messages/${messageId}/tags/${tagId}`, data);
  }

  getTodoTags(roomId: string) {
    return this.request<TagsResponse>('GET', `/rooms/${roomId}/tags/todo`);
  }

  getAllTags(limit = 30) {
    return this.request<TagsResponse>('GET', `/tags/all?limit=${limit}`);
  }

  // Stamps
  getStampPacks() {
    return this.request<StampPacksResponse>('GET', '/stamps/packs');
  }

  getStampPack(packId: string) {
    return this.request<StampPackResponse>('GET', `/stamps/packs/${packId}`);
  }

  generateStampPack(prompt: string, name: string, roomId?: string | null, labels?: string[]) {
    return this.request('POST', '/stamps/generate', { prompt, name, room_id: roomId, labels });
  }

  deleteStampPack(packId: string) {
    return this.request('DELETE', `/stamps/packs/${packId}`);
  }

  renameStampPack(packId: string, name: string) {
    return this.request('PUT', `/stamps/packs/${packId}`, { name });
  }

  deleteStamp(stampId: string) {
    return this.request('DELETE', `/stamps/${stampId}`);
  }

  // Media Gallery
  getMediaGallery(roomId: string, { tag, category, offset = 0, limit = 30 }: {
    tag?: string; category?: string; offset?: number; limit?: number;
  } = {}) {
    let url = `/rooms/${roomId}/media/gallery?offset=${offset}&limit=${limit}`;
    if (tag) url += `&tag=${tag}`;
    if (category) url += `&category=${category}`;
    return this.request<MediaGalleryResponse>('GET', url);
  }

  // Home
  getPortalLinks() {
    return this.request<PortalLinksResponse>('GET', '/rooms/portal-links');
  }

  // Message publish
  togglePublish(roomId: string, messageId: string, isPublished: boolean) {
    return this.request('PATCH', `/rooms/${roomId}/messages/${messageId}/publish`, { is_published: isPublished });
  }

  // Message edit
  editMessage(roomId: string, messageId: string, content: string) {
    return this.request<MessageResponse>('PUT', `/rooms/${roomId}/messages/${messageId}`, { content });
  }

  getMessageEdits(roomId: string, messageId: string) {
    return this.request<{ edits: Array<{ content: string; edited_at: string; edited_by_name?: string }> }>('GET', `/rooms/${roomId}/messages/${messageId}/edits`);
  }

  getAnnouncements(limit = 20) {
    return this.request<MessagesResponse>('GET', `/rooms/announcements?limit=${limit}`);
  }

  // Admin
  getAdminUsers() {
    return this.request<UsersResponse>('GET', '/admin/users');
  }

  createAdminUser(data: Partial<User> & { password?: string }) {
    return this.request<{ user: User }>('POST', '/admin/users', data);
  }

  updateAdminUser(id: string, data: Partial<User> & { password?: string }) {
    return this.request<{ user: User }>('PUT', `/admin/users/${id}`, data);
  }

  updateAdminUserStatus(id: string, is_active: boolean) {
    return this.request('PATCH', `/admin/users/${id}/status`, { is_active });
  }

  // Access log (admin) — 最終投稿/最終閲覧の集計 (users サマリ + user×room matrix)
  getAdminAccessLog() {
    return this.request<{
      users: Array<User & { last_post_at?: string | null; last_view_at?: string | null }>;
      matrix: Array<{ user_id: string; room_id: string; room_name: string; last_post_at?: string | null; last_view_at?: string | null }>;
    }>('GET', '/admin/access-log');
  }

  // Portal Links (admin)
  getAdminPortalLinks() {
    return this.request<PortalLinksResponse>('GET', '/admin/portal-links');
  }

  createPortalLink(data: Partial<PortalLink>) {
    return this.request<{ link: PortalLink }>('POST', '/admin/portal-links', data);
  }

  updatePortalLink(id: string, data: Partial<PortalLink>) {
    return this.request<{ link: PortalLink }>('PUT', `/admin/portal-links/${id}`, data);
  }

  deletePortalLink(id: string) {
    return this.request('DELETE', `/admin/portal-links/${id}`);
  }

  // Webhooks
  getWebhooks() {
    return this.request<WebhooksResponse>('GET', '/admin/webhooks');
  }

  createWebhook(data: Partial<Webhook>) {
    return this.request<{ webhook: Webhook }>('POST', '/admin/webhooks', data);
  }

  updateWebhook(id: string, data: Partial<Webhook>) {
    return this.request<{ webhook: Webhook }>('PUT', `/admin/webhooks/${id}`, data);
  }

  deleteWebhook(id: string) {
    return this.request('DELETE', `/admin/webhooks/${id}`);
  }

  testWebhook(id: string) {
    return this.request('POST', `/admin/webhooks/${id}/test`);
  }

  // Dictionary cultivation (辞書育成, admin)
  getDictionaryAliases(scope = 'auto', search = '') {
    const q = new URLSearchParams({ scope });
    if (search) q.set('search', search);
    return this.request<DictionaryAliasesResponse>('GET', `/admin/dictionary/aliases?${q.toString()}`);
  }

  approveDictionaryAlias(id: string) {
    return this.request('POST', `/admin/dictionary/aliases/${id}/approve`);
  }

  rejectDictionaryAlias(id: string) {
    return this.request('POST', `/admin/dictionary/aliases/${id}/reject`);
  }

  setDictionaryReading(termId: string, reading: string) {
    return this.request('PATCH', `/admin/dictionary/terms/${termId}/reading`, { reading });
  }

  addDictionaryAlias(term: string, alias: string, reading = '') {
    return this.request('POST', '/admin/dictionary/aliases', { term, alias, ...(reading ? { reading } : {}) });
  }

  getDictionaryTerms(search = '') {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    return this.request<DictionaryTermsResponse>('GET', `/admin/dictionary/terms${q}`);
  }

  updateDictionaryTerm(id: string, fields: Partial<DictionaryTerm>) {
    return this.request<{ term: DictionaryTerm }>('PATCH', `/admin/dictionary/terms/${id}`, fields);
  }

  // 語の取り消し / 取り消しの解除 (#375)。rejected は用語リスト(音声認識の語彙)から外れる
  rejectDictionaryTerm(id: string) {
    return this.request<{ term: DictionaryTerm }>('POST', `/admin/dictionary/terms/${id}/reject`);
  }

  restoreDictionaryTerm(id: string) {
    return this.request<{ term: DictionaryTerm }>('POST', `/admin/dictionary/terms/${id}/restore`);
  }

  createDictionaryTerm(fields: Partial<DictionaryTerm>) {
    return this.request<{ term: DictionaryTerm }>('POST', '/admin/dictionary/terms', fields);
  }
}

export const api = new ApiClient();

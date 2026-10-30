import type {
  User, Room, RoomMember, Message, Tag, MessageTag, StampPack, Stamp, MediaItem,
  PortalLink, Webhook, DictionaryTerm, DictionaryAlias,
} from '../types';
import { trimEventsForKeepalive } from './voiceLogPayload';

/** ★ 2026-09-26: GET /agent-api/config/tts-options の応答 */
export interface TtsOptions {
  global_provider: string;
  room_override_effective: boolean;
  default_engine: string | null;
  engines: { id: string; label: string; available: boolean }[];
  voices: Record<string, { id: string; name: string }[]>;
}

const API_BASE = '/api';

// #322: transport 層の間欠失敗（Cloudflare↔オリジン↔回線のストール）に対する client 耐性。
// GET のみ transient 失敗を限定リトライ + 全 method にタイムアウト。POST/PUT/DELETE は
// 二重送信回避のためリトライしない。
const RETRY_STATUS = new Set([408, 429, 502, 503, 504]);

/**
 * ★ #592 電波が切れたとき・時間切れのときに画面に出す文。以前はブラウザの英語
 *   (Failed to fetch / Load failed / signal is aborted without reason) がそのまま赤字で出ていた。
 *   ログイン・招待・名前の変更・転送・部屋の設定など 30 か所以上がこの通り道を通る。手本は #537 (sendRoomMessage)
 */
export const NETWORK_ERROR_MESSAGE = 'つながっていません。電波を確かめて、もう一度お試しください';
/** 会話モードの開始 (session・道具一覧) の時間切れ。MCP の冷間起動 (最悪 30 秒級) を吸収する */
export const VOICE_CHAT_START_TIMEOUT_MS = 60_000;
/** 会話モードの道具の呼び出し。サーバの MCP の待ち (30 秒) より少し長く */
export const VOICE_CHAT_TOOL_TIMEOUT_MS = 35_000;
export const TIMEOUT_ERROR_MESSAGE = '時間がかかりすぎました。電波を確かめて、もう一度お試しください';

/** つながらない (TypeError) / 時間切れ (AbortError) を日本語の案内に置き換える。それ以外はそのまま */
function friendlyNetworkError(err: unknown): unknown {
  if (err instanceof Error && err.name === 'AbortError') return new Error(TIMEOUT_ERROR_MESSAGE);
  if (err instanceof TypeError) return new Error(NETWORK_ERROR_MESSAGE);
  return err;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withJitter = (ms: number) => ms + Math.floor(Math.random() * 150);

type Json = Record<string, unknown>;

// --- API 応答形 (client が消費するフィールドのみ。詳細は ../types) ---
export interface AuthResponse { token: string; user: User; error?: string }
/** 削除された投稿の退避 (管理者だけ、docs/02 deleted_message_contents) */
export interface DeletedMessageEntry {
  message_id: string; content: string | null; deleted_at: string; type: string; room_id: string; created_at: string;
  room_name: string | null; sender_display_name: string; deleted_by_display_name: string | null;
}
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
/** 宛名の候補 (音声の編集画面)。部屋で人が直した版の冒頭の呼びかけを多い順に */
export interface VoiceAddressCandidatesResponse { candidates: { text: string; count: number }[] }
export interface AgentIdentityResponse { user_id: string | null; display_name: string | null }
/** #356 配信中クライアントのビルド ID。未ビルド (dev) では null */
export interface VersionResponse { build_id: string | null }

export type UploadProgressHandler = (percent: number) => void;

class ApiClient {
  token: string | null;
  requestTimeoutMs: number;
  uploadStallMs: number;
  uploadResponseWaitMs: number;
  retryBackoffMs: number[];

  constructor() {
    this.token = localStorage.getItem('token');
    // #322 リトライ/タイムアウト設定（テストで上書き可能）
    this.requestTimeoutMs = 10000;
    // ★ 添付は大きいので全体の時間でなく「最後にバイトが動いてから」で切る (改善ループ 12 回目)
    this.uploadStallMs = 60000;
    // ★ 送り終わった後は onprogress が来ない (サーバが動画のサムネイル等を作っている)。そこは長く待つ (改善ループ 13 回目)
    this.uploadResponseWaitMs = 5 * 60000;
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

      // ★ 改善ループ 12 回目: 電波が途中で止まると、決着しないまま「アップロード中…」で入力欄ごと固まった。
      //   バイトが uploadStallMs 動かなければ打ち切る (進むたびに数え直す)
      let stall: ReturnType<typeof setTimeout> | undefined;
      const settle = () => { if (stall) clearTimeout(stall); };
      const arm = (ms = this.uploadStallMs) => {
        settle();
        stall = setTimeout(() => { xhr.abort(); reject(new Error(TIMEOUT_ERROR_MESSAGE)); }, ms);
      };
      // ★ 送り終わったら、応答を待つ長い時間に切り替える (そこで 60 秒で切ると、サーバでは投稿ができているのに失敗に見え、二重に送られる)
      xhr.upload.onload = () => arm(this.uploadResponseWaitMs);
      xhr.upload.onprogress = (e) => {
        arm();
        if (onProgress && e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        settle();
        // ★ #592 JSON でない応答 (プロキシの HTML の 413/502 など) でも必ず決着させる。
        //   以前は JSON.parse の例外で Promise が決着せず、送信中のまま止まった
        let data: (T & { error?: string }) | undefined;
        try {
          data = JSON.parse(xhr.responseText) as T & { error?: string };
        } catch {
          reject(new Error(`送れませんでした (応答 ${xhr.status})。もう一度お試しください`));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data.error || 'アップロードに失敗しました'));
        }
      };

      xhr.onerror = () => { settle(); reject(new Error(NETWORK_ERROR_MESSAGE)); };   // ★ #592
      xhr.send(formData);
      arm();
    });
  }

  /**
   * ★ #539 ログインしている状態で 401 (期限切れ・無効) が返ったときに呼ぶ。authStore が登録して、ログイン画面へ移す。
   *   以前は 401 を特別扱いせず、帯が出るだけで、アプリを閉じて開き直すまでログイン画面に戻らなかった。
   *   ★ api → authStore を import すると循環するので、受け手を登録してもらう形
   */
  private onUnauthorized: (() => void) | null = null;
  setOnUnauthorized(fn: (() => void) | null): void { this.onUnauthorized = fn; }
  /** socket の接続が認証で断られたときにも同じ受け手へ (services/socket.ts から) */
  notifyUnauthorized(): void { this.onUnauthorized?.(); }

  setToken(token: string | null): void {
    const prev = this.token;
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else if (localStorage.getItem('token') === prev) {
      // ★ 自分の鍵のときだけ消す (2026-10-30 小野さん判断 D)。鍵はタブで共有なので、鍵の切れた古いタブが
      //   別のタブで入り直した新しい鍵まで消し、そちらも次の起動でログアウトされていた
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
          throw Object.assign(new Error(res.ok ? '応答の解析に失敗しました' : `リクエストに失敗しました (${res.status})`), { status: res.status });
        }

        if (!res.ok) {
          // ★ #539 ログイン中の 401 = 期限切れ・無効。ログイン画面での打ち間違い (/auth/login) は除く
          if (res.status === 401 && this.token && !path.startsWith('/auth/login')) this.onUnauthorized?.();
          if (isGet && RETRY_STATUS.has(res.status)) {
            lastError = new Error(data?.error || `status ${res.status}`);
            continue;
          }
          // ★ #600 status も載せる (403 外された・404 消された を圏外と見分ける。覚えた部屋の中身を捨てるか決める)
          throw Object.assign(new Error(data?.error || 'リクエストに失敗しました'), { status: res.status });
        }
        return data as T;
      } catch (err) {
        // ネットワーク断（TypeError）/ タイムアウト（AbortError）は GET のみ transient 扱い。
        const isTransient = (err instanceof Error && err.name === 'AbortError') || err instanceof TypeError;
        if (isGet && isTransient) {
          lastError = friendlyNetworkError(err) as Error;   // ★ #592
          continue;
        }
        throw friendlyNetworkError(err);   // ★ #592 GET 以外は 1 回で確定する
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

  // #511 基準より新しい投稿を古い順に (日付・引用へ飛んだあと、下へ読み足す)
  getMessagesAfter(roomId: string, after: string, limit = 20) {
    return this.request<MessagesResponse>('GET', `/rooms/${roomId}/messages?limit=${limit}&after=${after}`);
  }

  // #476 日付へ飛ぶ。tz_offset は Date.getTimezoneOffset() (日本なら -540)
  getMessageDays(roomId: string, month: string, tzOffset = new Date().getTimezoneOffset()) {
    const q = new URLSearchParams({ month, tz_offset: String(tzOffset) });
    return this.request<{ days: string[] }>('GET', `/rooms/${roomId}/messages/days?${q}`);
  }

  getFirstMessageOfDay(roomId: string, date: string, tzOffset = new Date().getTimezoneOffset()) {
    const q = new URLSearchParams({ date, tz_offset: String(tzOffset) });
    return this.request<{ message_id: string | null }>('GET', `/rooms/${roomId}/messages/first-of-day?${q}`);
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
    // ★ 長い文の合成は数十秒かかる (500 字で 33 秒の実例)。会話モードの開始と同じ 60 秒 (改善ループ 14 回目)
    return this._agentApi<Blob>('POST', '/tts/synthesize', { text, room_id: roomId }, { as: 'blob', errorMessage: 'TTS に失敗しました', timeoutMs: VOICE_CHAT_START_TIMEOUT_MS });
  }

  // === #405 Realtime 音声会話 (docs/08 §12) — agent-server /voice-chat/... proxy 経由 ===

  /** 会話を始める。★ MCP の冷間起動をここで吸収するので、数十秒かかることがある */
  createVoiceChatSession(roomId: string): Promise<{ session_id: string; client_secret: string; model: string }> {
    // ★ 開始は MCP の冷間起動を吸収するので数十秒かかることがある。ふつうの 10 秒では切らない (2026-10-23 小野さん判断)
    return this._agentApi('POST', '/voice-chat/session', { room_id: roomId }, { errorMessage: '会話を開始できませんでした', timeoutMs: VOICE_CHAT_START_TIMEOUT_MS });
  }

  /** モデルが要求した道具を、サーバ側で実行して結果をもらう (ブラウザは実行しない) */
  voiceChatToolCall(sessionId: string, callId: string, name: string, args: string): Promise<{ output: string; elapsed_ms: number; truncated?: boolean; original_bytes?: number }> {
    // ★ サーバの MCP は 30 秒まで待つ。10 秒で切ると実行は済んだのに「失敗」と伝える (改善ループ 14 回目)
    return this._agentApi('POST', '/voice-chat/tool-call', { session_id: sessionId, call_id: callId, name, arguments: args }, { timeoutMs: VOICE_CHAT_TOOL_TIMEOUT_MS });
  }

  /**
   * ★ 昇格 — 会話の「良かった 1 つ」を、いま居るルームへ残す (docs/08 §1.2.2 / R3)。
   * ★ 行き先は渡さない。session のルームが唯一の正 (サーバ側で決まる)。
   * ★★ 失敗は握りつぶさない —— 残ったと思って残っていない、を作らないため。
   */
  voiceChatPromote(sessionId: string, text: string): Promise<{ ok: boolean }> {
    return this._agentApi('POST', '/voice-chat/promote', { session_id: sessionId, text }, { errorMessage: '残せませんでした' });
  }

  /**
   * ★ そのルームで使える道具の一覧 (#418、docs/08 §12.17)。
   * ★★ MCP を起こすので数秒〜数十秒かかる。設定画面を開いた時に 1 回だけ呼ぶ。
   */
  getVoiceChatTools(roomId: string): Promise<{ tools: Array<{ name: string; description: string }>; default_denied: string[]; protected: string[] }> {
    return this._agentApi('GET', `/voice-chat/tools?room_id=${encodeURIComponent(roomId)}`, undefined, { timeoutMs: VOICE_CHAT_START_TIMEOUT_MS });   // 道具一覧も MCP を起こす
  }

  /** 計測イベントの送信 (docs/08 §12.6)。★ 失敗しても会話は止めない */
  voiceChatLog(sessionId: string, events: unknown[]): Promise<{ ok: boolean }> {
    return this._agentApi('POST', '/voice-chat/log', { session_id: sessionId, events }, { fallback: { ok: false } });
  }

  /**
   * ★★★★ 離脱中 (リロード / タブを閉じる) に計測を送る。
   *
   * ★ 通常の `fetch` は離脱で打ち切られるので届かない。★★ `keepalive: true` を使う。
   * ★★★ `navigator.sendBeacon` は **ヘッダを付けられない**ので使えない (認証が Bearer)。
   * ★★★★ 本文に 64KB の上限があるため、**古い方から捨てて末尾を守る** (`trimEventsForKeepalive`)。
   *
   * ★ 戻り値は「送ろうとしたか」だけ。**届いたかは分からない** (離脱後は結果を受け取れない)。
   */
  voiceChatLogKeepalive(sessionId: string, events: unknown[]): { sent: boolean; dropped: number } {
    if (!sessionId || !events.length) return { sent: false, dropped: 0 };
    const { events: kept, dropped } = trimEventsForKeepalive(sessionId, events);
    try {
      void fetch('/agent-api/voice-chat/log', {
        method: 'POST',
        keepalive: true,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, events: kept }),
      }).catch(() => {});
      return { sent: true, dropped };
    } catch {
      // ★ 離脱中なので出せる場所が無い。★★ 会話の後片付けは止めない
      return { sent: false, dropped };
    }
  }

  // === Room agent settings (#156) — agent-server /config/room/:roomId/... proxy 経由 ===
  async _agentApi<T = Json>(
    method: string,
    path: string,
    body?: unknown,
    extra: { as?: 'json' | 'blob'; fallback?: T; errorMessage?: string; timeoutMs?: number } = {},
  ): Promise<T> {
    const { as = 'json', fallback, errorMessage = 'agent-server リクエストに失敗しました', timeoutMs = this.requestTimeoutMs } = extra;
    try {
      const opts: RequestInit & { headers: Record<string, string> } = {
        method,
        headers: { Authorization: `Bearer ${this.token}` },
      };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      // ★ 時間切れを付ける (request() と同じ長さ)。以前は無く、agent-server が応答しないと設定画面が回り続けた (改善ループ 10-13)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(`/agent-api${path}`, { ...opts, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        if (fallback !== undefined) return fallback;
        let err = errorMessage;
        try { const j = await res.json() as { error?: string }; err = j.error || err; } catch {}
        // ★ status も載せる (#408)。**サーバが断ったのか、そもそも届かなかったのか**が
        //   呼び出し側で区別できないと、失敗の理由を後から追えない
        throw Object.assign(new Error(err), { status: res.status });
      }
      return (as === 'blob' ? await res.blob() : await res.json()) as T;
    } catch (e) {
      // fallback 指定メソッド (getCcProjects/getAgentIdentity) は失敗を silent に飲む
      if (fallback !== undefined) return fallback;
      throw friendlyNetworkError(e);   // ★ #592
    }
  }

  /** ★ 2026-09-26: 読み上げエンジン・声の選択肢 (一覧は agent-server の lib/ttsRoom.mts の 1 か所) */
  getTtsOptions() {
    return this._agentApi<TtsOptions>('GET', '/config/tts-options');
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

  /** #607 通行証つきの入口 URL (docs/11 §5.2)。出せないときは投げる */
  getAppPass(roomId: string, index: number, url: string) {
    return this.request<{ url: string }>('POST', `/rooms/${roomId}/app-pass`, { index, url });
  }

  /** #463 自分の分だけ、このルームの通知を鳴らす / 鳴らさない */
  setRoomNotification(roomId: string, muted: boolean) {
    return this.request<{ push_muted: boolean }>('PUT', `/rooms/${roomId}/notification`, { muted });
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

  /** #485-2 グループを削除 (作った本人・自分しかいないときだけ。サーバーが最終判定) */
  deleteRoom(roomId: string) {
    return this.request('DELETE', `/rooms/${roomId}`);
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

  getVoiceAddressCandidates(roomId: string) {
    return this.request<VoiceAddressCandidatesResponse>('GET', `/rooms/${roomId}/voice-address-candidates`);
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

  /** #607 ホーム画面のタブの通行証つき入口 URL (docs/11 §5.4)。出せないときは投げる */
  getPortalAppPass(linkId: string) {
    return this.request<{ url: string }>('POST', `/rooms/portal-links/${linkId}/app-pass`, {});
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

  // 削除された投稿 (admin、2026-10-30 利用者判断 3)
  getAdminDeletedMessages() {
    return this.request<{ messages: DeletedMessageEntry[] }>('GET', '/admin/deleted-messages');
  }

  restoreAdminDeletedMessage(messageId: string) {
    return this.request<{ success: boolean }>('POST', `/admin/deleted-messages/${messageId}/restore`);
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

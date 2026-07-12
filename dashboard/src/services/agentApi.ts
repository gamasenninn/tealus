export type AgentSettings = Record<string, unknown> & {
  max_turns?: number;
  context_messages?: number;
};

export interface McpConfig { [key: string]: unknown }

export interface SettingsResponse { settings: AgentSettings }
export interface McpConfigResponse { mcpConfig: McpConfig }
export interface EnvResponse { env: Record<string, string> }
export interface SystemPromptResponse { custom: string; default: string; isCustom: boolean }
export interface ServerLogEntry { timestamp: string; level: string; message: string }
export interface ServerLogsResponse { logs: ServerLogEntry[]; total: number; date: string }
export interface LogDatesResponse { dates: string[] }

export interface AgentRoomInfo {
  room_id: string;
  name?: string;
  type?: string;
  member_count?: number | string;
  enabled?: boolean;
  response_mode?: string;
  tts_model_uuid?: string;
}
export interface AgentRoomsResponse { rooms: AgentRoomInfo[] }

export interface RoomSettingsData {
  response_mode?: string;
  enabled?: boolean;
  tts_model_uuid?: string;
  [key: string]: unknown;
}
export interface RoomSettingsResponse { settings: RoomSettingsData }
export interface RoomContentResponse { content: string }
export interface RoomMcpResponse { mcpConfig: McpConfig | null }

/**
 * Agent Server API クライアント
 * agent-server の設定ファイル読み書き用
 */
class AgentApiClient {
  baseUrl: string;

  constructor() {
    this.baseUrl = '/agent-api';
  }

  async request<T>(method: string, path: string, body: unknown = null): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('dashboard_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const options: RequestInit = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${this.baseUrl}${path}`, options);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  getSettings(): Promise<SettingsResponse> {
    return this.request('GET', '/config/settings');
  }

  updateSettings(settings: AgentSettings): Promise<unknown> {
    return this.request('PUT', '/config/settings', { settings });
  }

  getMcpConfig(): Promise<McpConfigResponse> {
    return this.request('GET', '/config/mcp');
  }

  updateMcpConfig(mcpConfig: McpConfig): Promise<unknown> {
    return this.request('PUT', '/config/mcp', { mcpConfig });
  }

  getEnv(): Promise<EnvResponse> {
    return this.request('GET', '/config/env');
  }

  // ログ
  getLogs(date: string | null = null, limit = 100, offset = 0, level: string | null = null, q: string | null = null): Promise<ServerLogsResponse> {
    let url = `/logs?limit=${limit}&offset=${offset}`;
    if (date) url += `&date=${date}`;
    if (level) url += `&level=${level}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    return this.request('GET', url);
  }
  getLogDates(): Promise<LogDatesResponse> {
    return this.request('GET', '/logs/dates');
  }
  getSystemPrompt(): Promise<SystemPromptResponse> {
    return this.request('GET', '/config/system-prompt');
  }
  updateSystemPrompt(content: string): Promise<unknown> {
    return this.request('PUT', '/config/system-prompt', { content });
  }

  // ルーム設定
  getRoomsList(): Promise<AgentRoomsResponse> {
    return this.request('GET', '/config/rooms');
  }
  getAgentRooms(agentId: string): Promise<AgentRoomsResponse> {
    return this.request('GET', `/config/rooms/${agentId}`);
  }
  getRoomSettings(roomId: string): Promise<RoomSettingsResponse> {
    return this.request('GET', `/config/room/${roomId}/settings`);
  }
  updateRoomSettings(roomId: string, settings: RoomSettingsData): Promise<unknown> {
    return this.request('PUT', `/config/room/${roomId}/settings`, { settings });
  }
  getRoomClaudeMd(roomId: string): Promise<RoomContentResponse> {
    return this.request('GET', `/config/room/${roomId}/claude-md`);
  }
  updateRoomClaudeMd(roomId: string, content: string): Promise<unknown> {
    return this.request('PUT', `/config/room/${roomId}/claude-md`, { content });
  }
  getRoomLightPrompt(roomId: string): Promise<RoomContentResponse> {
    return this.request('GET', `/config/room/${roomId}/light-prompt`);
  }
  updateRoomLightPrompt(roomId: string, content: string): Promise<unknown> {
    return this.request('PUT', `/config/room/${roomId}/light-prompt`, { content });
  }
  getRoomMcp(roomId: string): Promise<RoomMcpResponse> {
    return this.request('GET', `/config/room/${roomId}/mcp`);
  }
  updateRoomMcp(roomId: string, mcpConfig: McpConfig): Promise<unknown> {
    return this.request('PUT', `/config/room/${roomId}/mcp`, { mcpConfig });
  }
}

export const agentApi = new AgentApiClient();

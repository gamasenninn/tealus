export interface User {
  id: string;
  display_name: string;
  login_id: string;
  role: string;
  is_bot?: boolean;
  is_active?: boolean;
  created_at: string;
}

export interface Room {
  id: string;
  name?: string;
  type: string;
  member_count?: number | string;
  created_at?: string;
  partner_display_name?: string;
}

export interface AgentLogMessage {
  id: string;
  created_at: string;
  room_name: string;
  content?: string;
  type: string;
}

export interface AgentLogContextEntry {
  sender_display_name: string;
  created_at: string;
  content?: string;
  type: string;
}

export interface AgentLogContextResponse {
  question?: AgentLogContextEntry;
  response: AgentLogContextEntry & { room_name: string };
}

export interface AgentStatsResponse {
  stats: {
    today_responses: number;
    week_responses: number;
    total_responses: number;
    avg_response_time_ms?: number;
  };
  room_stats: Array<{ room_id: string; room_name: string; count: number; last_at: string }>;
  contexts?: Array<{ id: string; room_name?: string; partner_display_name?: string; status: string }>;
}

export interface LoginResponse { user: User; token: string }
export interface MeResponse { user: User }
export interface UsersResponse { users: User[] }
export interface AgentsResponse { agents: User[] }
export interface RoomsResponse { rooms: Room[] }
export interface WebhooksResponse { webhooks: unknown[] }
export interface AgentLogsResponse { messages: AgentLogMessage[]; total: number }

class ApiClient {
  baseUrl: string;
  token: string | null;

  constructor() {
    this.baseUrl = '/api';
    this.token = localStorage.getItem('dashboard_token') || null;
  }

  setToken(token: string | null): void {
    this.token = token;
    if (token) {
      localStorage.setItem('dashboard_token', token);
    } else {
      localStorage.removeItem('dashboard_token');
    }
  }

  async request<T>(method: string, path: string, body: unknown = null): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const options: RequestInit = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${this.baseUrl}${path}`, options);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // Auth
  login(loginId: string, password: string): Promise<LoginResponse> {
    return this.request('POST', '/auth/login', { login_id: loginId, password });
  }
  getMe(): Promise<MeResponse> {
    return this.request('GET', '/auth/me');
  }

  // Admin
  getUsers(): Promise<UsersResponse> {
    return this.request('GET', '/admin/users');
  }
  getAgents(): Promise<AgentsResponse> {
    return this.request<UsersResponse>('GET', '/admin/users').then(data => ({
      agents: data.users.filter(u => u.is_bot),
    }));
  }
  getRooms(): Promise<RoomsResponse> {
    return this.request('GET', '/rooms');
  }
  getWebhooks(): Promise<WebhooksResponse> {
    return this.request('GET', '/admin/webhooks');
  }

  // モニタリング
  getAgentStats(): Promise<AgentStatsResponse> {
    return this.request('GET', '/admin/agent-stats');
  }
  getAgentLogContext(messageId: string): Promise<AgentLogContextResponse> {
    return this.request('GET', `/admin/agent-logs/${messageId}/context`);
  }
  getAgentLogs(offset = 0, limit = 20, roomId: string | null = null): Promise<AgentLogsResponse> {
    let url = `/admin/agent-logs?offset=${offset}&limit=${limit}`;
    if (roomId) url += `&room_id=${roomId}`;
    return this.request('GET', url);
  }
}

export const api = new ApiClient();

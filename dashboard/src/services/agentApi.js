/**
 * Agent Server API クライアント
 * agent-server の設定ファイル読み書き用
 */
class AgentApiClient {
  constructor() {
    this.baseUrl = '/agent-api';
  }

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('dashboard_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${this.baseUrl}${path}`, options);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  getSettings() {
    return this.request('GET', '/config/settings');
  }

  updateSettings(settings) {
    return this.request('PUT', '/config/settings', { settings });
  }

  getMcpConfig() {
    return this.request('GET', '/config/mcp');
  }

  updateMcpConfig(mcpConfig) {
    return this.request('PUT', '/config/mcp', { mcpConfig });
  }

  getEnv() {
    return this.request('GET', '/config/env');
  }

  // ログ
  getLogs(date = null, limit = 100, offset = 0, level = null, q = null) {
    let url = `/logs?limit=${limit}&offset=${offset}`;
    if (date) url += `&date=${date}`;
    if (level) url += `&level=${level}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    return this.request('GET', url);
  }
  getLogDates() {
    return this.request('GET', '/logs/dates');
  }
  getSystemPrompt() {
    return this.request('GET', '/config/system-prompt');
  }
  updateSystemPrompt(content) {
    return this.request('PUT', '/config/system-prompt', { content });
  }

  // ルーム設定
  getRoomsList() {
    return this.request('GET', '/config/rooms');
  }
  getRoomSettings(roomId) {
    return this.request('GET', `/config/room/${roomId}/settings`);
  }
  updateRoomSettings(roomId, settings) {
    return this.request('PUT', `/config/room/${roomId}/settings`, { settings });
  }
  getRoomClaudeMd(roomId) {
    return this.request('GET', `/config/room/${roomId}/claude-md`);
  }
  updateRoomClaudeMd(roomId, content) {
    return this.request('PUT', `/config/room/${roomId}/claude-md`, { content });
  }
  getRoomLightPrompt(roomId) {
    return this.request('GET', `/config/room/${roomId}/light-prompt`);
  }
  updateRoomLightPrompt(roomId, content) {
    return this.request('PUT', `/config/room/${roomId}/light-prompt`, { content });
  }
  getRoomMcp(roomId) {
    return this.request('GET', `/config/room/${roomId}/mcp`);
  }
  updateRoomMcp(roomId, mcpConfig) {
    return this.request('PUT', `/config/room/${roomId}/mcp`, { mcpConfig });
  }
}

export const agentApi = new AgentApiClient();

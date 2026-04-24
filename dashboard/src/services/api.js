class ApiClient {
  constructor() {
    this.baseUrl = '/api';
    this.token = localStorage.getItem('dashboard_token') || null;
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('dashboard_token', token);
    } else {
      localStorage.removeItem('dashboard_token');
    }
  }

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${this.baseUrl}${path}`, options);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // Auth
  login(loginId, password) {
    return this.request('POST', '/auth/login', { login_id: loginId, password });
  }
  getMe() {
    return this.request('GET', '/auth/me');
  }

  // Admin
  getUsers() {
    return this.request('GET', '/admin/users');
  }
  getAgents() {
    return this.request('GET', '/admin/users').then(data => ({
      agents: data.users.filter(u => u.is_bot),
    }));
  }
  getRooms() {
    return this.request('GET', '/rooms');
  }
  getWebhooks() {
    return this.request('GET', '/admin/webhooks');
  }

  // モニタリング
  getAgentStats() {
    return this.request('GET', '/admin/agent-stats');
  }
  getAgentLogContext(messageId) {
    return this.request('GET', `/admin/agent-logs/${messageId}/context`);
  }
  getAgentLogs(offset = 0, limit = 20, roomId = null) {
    let url = `/admin/agent-logs?offset=${offset}&limit=${limit}`;
    if (roomId) url += `&room_id=${roomId}`;
    return this.request('GET', url);
  }
}

export const api = new ApiClient();

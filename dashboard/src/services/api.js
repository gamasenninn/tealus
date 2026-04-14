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
  login(employeeId, password) {
    return this.request('POST', '/auth/login', { employee_id: employeeId, password });
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
}

export const api = new ApiClient();

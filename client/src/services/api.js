const API_BASE = '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const opts = { method, headers };
    if (body) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(`${API_BASE}${path}`, opts);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'リクエストに失敗しました');
    }
    return data;
  }

  // Auth
  login(employee_id, password) {
    return this.request('POST', '/auth/login', { employee_id, password });
  }

  register(employee_id, display_name, password) {
    return this.request('POST', '/auth/register', { employee_id, display_name, password });
  }

  getMe() {
    return this.request('GET', '/auth/me');
  }

  // Rooms
  getRooms() {
    return this.request('GET', '/rooms');
  }

  getRoom(roomId) {
    return this.request('GET', `/rooms/${roomId}`);
  }

  createGroup(name, memberIds) {
    return this.request('POST', '/rooms', { name, member_ids: memberIds });
  }

  createDirect(partnerId) {
    return this.request('POST', '/rooms/direct', { partner_id: partnerId });
  }

  // Messages
  getMessages(roomId, before = null, limit = 20) {
    let url = `/rooms/${roomId}/messages?limit=${limit}`;
    if (before) url += `&before=${before}`;
    return this.request('GET', url);
  }

  sendMessage(roomId, content, replyTo = null) {
    return this.request('POST', `/rooms/${roomId}/messages`, {
      content,
      reply_to: replyTo,
    });
  }

  // Media (single file or array of files)
  async uploadMedia(roomId, files) {
    const formData = new FormData();
    const fileArray = Array.isArray(files) ? files : [files];
    for (const file of fileArray) {
      formData.append('files', file);
    }

    const res = await fetch(`${API_BASE}/rooms/${roomId}/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'アップロードに失敗しました');
    return data;
  }

  // Read
  markRead(roomId, messageIds) {
    return this.request('POST', `/rooms/${roomId}/read`, { message_ids: messageIds });
  }

  // Users
  getUsers() {
    return this.request('GET', '/users');
  }

  // Push
  subscribePush(subscription) {
    return this.request('POST', '/push/subscribe', subscription);
  }

  unsubscribePush(endpoint) {
    return this.request('DELETE', '/push/subscribe', { endpoint });
  }

  // Profile
  updateProfile(data) {
    return this.request('PUT', '/auth/profile', data);
  }

  async uploadAvatar(file) {
    const formData = new FormData();
    formData.append('avatar', file);

    const res = await fetch(`${API_BASE}/auth/avatar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` },
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'アップロードに失敗しました');
    return data;
  }

  changePassword(current_password, new_password) {
    return this.request('PUT', '/auth/password', { current_password, new_password });
  }

  // Admin
  getAdminUsers() {
    return this.request('GET', '/admin/users');
  }

  createAdminUser(data) {
    return this.request('POST', '/admin/users', data);
  }

  updateAdminUser(id, data) {
    return this.request('PUT', `/admin/users/${id}`, data);
  }

  updateAdminUserStatus(id, is_active) {
    return this.request('PATCH', `/admin/users/${id}/status`, { is_active });
  }
}

export const api = new ApiClient();

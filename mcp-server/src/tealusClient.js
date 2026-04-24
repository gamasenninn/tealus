/**
 * Tealus Bot API クライアント
 * MCP Server から Tealus Server への HTTP 通信
 */
const fetch = require('node-fetch');
const FormData = require('form-data');

class TealusClient {
  constructor({ apiUrl, userId, password }) {
    this.apiUrl = apiUrl;
    this.userId = userId;
    this.password = password;
    this.token = null;
  }

  async login() {
    if (this.token) return;

    const res = await fetch(`${this.apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login_id: this.userId,
        password: this.password,
      }),
    });

    const data = await res.json();
    if (!data.token) {
      throw new Error(`Login failed: ${data.error || 'Unknown error'}`);
    }
    this.token = data.token;
  }

  async request(method, path, body = null) {
    await this.login();
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${this.apiUrl}/api${path}`, options);
    return res.json();
  }

  async pushMessage(roomId, content) {
    return this.request('POST', '/bot/push', { room_id: roomId, content });
  }

  async pushImage(roomId, buffer, filename, caption = '') {
    await this.login();
    const form = new FormData();
    form.append('room_id', roomId);
    form.append('image', buffer, { filename, contentType: 'image/png' });
    if (caption) form.append('content', caption);

    const res = await fetch(`${this.apiUrl}/api/bot/push-image`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        ...form.getHeaders(),
      },
      body: form,
    });
    return res.json();
  }

  async getMessages(roomId, limit = 20) {
    return this.request('GET', `/bot/messages?room_id=${roomId}&limit=${limit}`);
  }

  async getRooms() {
    return this.request('GET', '/bot/rooms');
  }

  async joinRoom(roomId) {
    return this.request('POST', `/bot/rooms/${roomId}/join`);
  }

  async markRead(messageIds) {
    return this.request('POST', '/bot/mark-read', { message_ids: messageIds });
  }
}

module.exports = { TealusClient };

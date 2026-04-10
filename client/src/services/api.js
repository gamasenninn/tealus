const API_BASE = '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('token');
  }

  /**
   * Common file upload via XHR with progress support
   */
  _upload(url, formData, onProgress) {
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
        const data = JSON.parse(xhr.responseText);
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
  getMessages(roomId, before = null, limit = 20, around = null) {
    let url = `/rooms/${roomId}/messages?limit=${limit}`;
    if (around) url += `&around=${around}`;
    else if (before) url += `&before=${before}`;
    return this.request('GET', url);
  }

  sendMessage(roomId, content, replyTo = null) {
    return this.request('POST', `/rooms/${roomId}/messages`, {
      content,
      reply_to: replyTo,
    });
  }

  // Media (single file or array of files)
  uploadMedia(roomId, files, onProgress) {
    const formData = new FormData();
    const fileArray = Array.isArray(files) ? files : [files];
    for (const file of fileArray) {
      formData.append('files', file);
    }
    return this._upload(`${API_BASE}/rooms/${roomId}/media`, formData, onProgress);
  }

  // Read
  markRead(roomId, messageIds) {
    return this.request('POST', `/rooms/${roomId}/read`, { message_ids: messageIds });
  }

  // Users
  getUsers() {
    return this.request('GET', '/users');
  }

  getOnlineUsers() {
    return this.request('GET', '/users/online');
  }

  // Push
  subscribePush(subscription) {
    return this.request('POST', '/push/subscribe', subscription);
  }

  unsubscribePush(endpoint) {
    return this.request('DELETE', '/push/subscribe', { endpoint });
  }

  // Room edit
  updateRoom(roomId, data) {
    return this.request('PUT', `/rooms/${roomId}`, data);
  }

  uploadRoomIcon(roomId, file) {
    const formData = new FormData();
    formData.append('icon', file);
    return this._upload(`${API_BASE}/rooms/${roomId}/icon`, formData);
  }

  // Search
  search(q, roomId, offset = 0) {
    let url = `/search?q=${encodeURIComponent(q)}&offset=${offset}`;
    if (roomId) url += `&room_id=${roomId}`;
    return this.request('GET', url);
  }

  // Reactions
  toggleReaction(roomId, messageId, emoji) {
    return this.request('POST', `/rooms/${roomId}/messages/${messageId}/reactions`, { emoji });
  }

  // Messages
  deleteMessage(roomId, messageId) {
    return this.request('DELETE', `/rooms/${roomId}/messages/${messageId}`);
  }

  // Members
  addMember(roomId, userId) {
    return this.request('POST', `/rooms/${roomId}/members`, { user_id: userId });
  }

  leaveRoom(roomId) {
    return this.request('DELETE', `/rooms/${roomId}/members/me`);
  }

  kickMember(roomId, userId) {
    return this.request('DELETE', `/rooms/${roomId}/members/${userId}`);
  }

  changeMemberRole(roomId, userId, role) {
    return this.request('PUT', `/rooms/${roomId}/members/${userId}/role`, { role });
  }

  // Voice
  uploadVoice(roomId, blob, onProgress, replyTo) {
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const formData = new FormData();
    if (replyTo) formData.append('reply_to', replyTo);
    formData.append('voice', blob, `voice.${ext}`);
    return this._upload(`${API_BASE}/rooms/${roomId}/voice`, formData, onProgress);
  }

  // Transcription
  editTranscription(messageId, text) {
    return this.request('PUT', `/messages/${messageId}/transcription`, { text });
  }

  getTranscriptionHistory(messageId) {
    return this.request('GET', `/messages/${messageId}/transcription/history`);
  }

  // Profile
  updateProfile(data) {
    return this.request('PUT', '/auth/profile', data);
  }

  uploadAvatar(file) {
    const formData = new FormData();
    formData.append('avatar', file);
    return this._upload(`${API_BASE}/auth/avatar`, formData);
  }

  changePassword(current_password, new_password) {
    return this.request('PUT', '/auth/password', { current_password, new_password });
  }

  // Tags
  getRoomTags(roomId) {
    return this.request('GET', `/rooms/${roomId}/tags`);
  }

  suggestTags(roomId, query) {
    return this.request('GET', `/rooms/${roomId}/tags/suggest?q=${encodeURIComponent(query)}`);
  }

  createTag(roomId, name) {
    return this.request('POST', `/rooms/${roomId}/tags`, { name });
  }

  getMessageTags(messageId) {
    return this.request('GET', `/messages/${messageId}/tags`);
  }

  addMessageTag(messageId, { tag_id, name }) {
    return this.request('POST', `/messages/${messageId}/tags`, tag_id ? { tag_id } : { name });
  }

  removeMessageTag(messageId, tagId) {
    return this.request('DELETE', `/messages/${messageId}/tags/${tagId}`);
  }

  // Stamps
  getStampPacks() {
    return this.request('GET', '/stamps/packs');
  }

  getStampPack(packId) {
    return this.request('GET', `/stamps/packs/${packId}`);
  }

  generateStampPack(prompt, name, roomId, labels) {
    return this.request('POST', '/stamps/generate', { prompt, name, room_id: roomId, labels });
  }

  deleteStampPack(packId) {
    return this.request('DELETE', `/stamps/packs/${packId}`);
  }

  renameStampPack(packId, name) {
    return this.request('PUT', `/stamps/packs/${packId}`, { name });
  }

  deleteStamp(stampId) {
    return this.request('DELETE', `/stamps/${stampId}`);
  }

  // Media Gallery
  getMediaGallery(roomId, { tag, category, offset = 0, limit = 30 } = {}) {
    let url = `/rooms/${roomId}/media/gallery?offset=${offset}&limit=${limit}`;
    if (tag) url += `&tag=${tag}`;
    if (category) url += `&category=${category}`;
    return this.request('GET', url);
  }

  // Announcements
  getAnnouncements(limit = 20) {
    return this.request('GET', `/rooms/announcements?limit=${limit}`);
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

  // Webhooks
  getWebhooks() {
    return this.request('GET', '/admin/webhooks');
  }

  createWebhook(data) {
    return this.request('POST', '/admin/webhooks', data);
  }

  updateWebhook(id, data) {
    return this.request('PUT', `/admin/webhooks/${id}`, data);
  }

  deleteWebhook(id) {
    return this.request('DELETE', `/admin/webhooks/${id}`);
  }

  testWebhook(id) {
    return this.request('POST', `/admin/webhooks/${id}/test`);
  }
}

export const api = new ApiClient();

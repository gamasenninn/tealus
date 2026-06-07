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
  login(login_id, password) {
    return this.request('POST', '/auth/login', { login_id, password });
  }

  register(login_id, display_name, password) {
    return this.request('POST', '/auth/register', { login_id, display_name, password });
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

  sendMessage(roomId, content, replyTo = null, forwardedFrom = null) {
    return this.request('POST', `/rooms/${roomId}/messages`, {
      content,
      reply_to: replyTo,
      forwarded_from: forwardedFrom,
    });
  }

  forwardMedia(targetRoomId, sourceMessageId) {
    return this.request('POST', `/rooms/${targetRoomId}/media/forward`, {
      source_message_id: sourceMessageId,
    });
  }

  /**
   * cc-queue から登録済 project 一覧を取得 (#253)
   * mention picker の virtual user 候補に使う。
   */
  async getCcProjects() {
    try {
      const res = await fetch('/agent-api/agent/cc-projects', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) return { projects: [] };
      return await res.json();
    } catch {
      return { projects: [] };
    }
  }

  /**
   * Deep agent の処理を中断 (#250)
   */
  async cancelAgent(roomId) {
    const res = await fetch('/agent-api/agent/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ room_id: roomId }),
    });
    if (!res.ok) {
      let err = '中断リクエストに失敗しました';
      try { const j = await res.json(); err = j.error || err; } catch {}
      throw new Error(err);
    }
    return await res.json();
  }

  /**
   * TTS synthesis (personal read-aloud) — returns Blob (audio/wav)
   * Uses room's TTS model setting. Safe to call from any component.
   */
  async synthesizeTts(text, roomId) {
    const res = await fetch('/agent-api/tts/synthesize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ text, room_id: roomId }),
    });
    if (!res.ok) {
      let err = 'TTS に失敗しました';
      try { const j = await res.json(); err = j.error || err; } catch {}
      throw new Error(err);
    }
    return await res.blob();
  }

  // === Room agent settings (#156) — agent-server /config/room/:roomId/... proxy 経由 ===
  async _agentApi(method, path, body) {
    const opts = {
      method,
      headers: { Authorization: `Bearer ${this.token}` },
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`/agent-api${path}`, opts);
    if (!res.ok) {
      let err = 'agent-server リクエストに失敗しました';
      try { const j = await res.json(); err = j.error || err; } catch {}
      throw new Error(err);
    }
    return await res.json();
  }

  getRoomAgentSettings(roomId) {
    return this._agentApi('GET', `/config/room/${roomId}/settings`);
  }

  updateRoomAgentSettings(roomId, settings) {
    return this._agentApi('PUT', `/config/room/${roomId}/settings`, { settings });
  }

  getRoomLightPrompt(roomId) {
    return this._agentApi('GET', `/config/room/${roomId}/light-prompt`);
  }

  updateRoomLightPrompt(roomId, content) {
    return this._agentApi('PUT', `/config/room/${roomId}/light-prompt`, { content });
  }

  getRoomClaudeMd(roomId) {
    return this._agentApi('GET', `/config/room/${roomId}/claude-md`);
  }

  updateRoomClaudeMd(roomId, content) {
    return this._agentApi('PUT', `/config/room/${roomId}/claude-md`, { content });
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
  search(q, { roomId, tagId, tagNames, isDone, sort, offset = 0 } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (roomId) params.set('room_id', roomId);
    if (tagId) params.set('tag_id', tagId);
    if (tagNames && tagNames.length > 0) params.set('tag_names', tagNames.join(','));
    if (isDone !== undefined && isDone !== '') params.set('is_done', isDone);
    if (sort) params.set('sort', sort);
    params.set('offset', offset);
    return this.request('GET', `/search?${params}`);
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

  // #216: voice transcription 再実行 (新 version で Whisper + AI 整形を再実行)
  retranscribeVoiceMessage(messageId) {
    return this.request('POST', `/messages/${messageId}/transcription/retranscribe`);
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

  createTag(roomId, name, is_todo = false) {
    return this.request('POST', `/rooms/${roomId}/tags`, { name, is_todo });
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

  updateMessageTag(messageId, tagId, data) {
    return this.request('PATCH', `/messages/${messageId}/tags/${tagId}`, data);
  }

  getTodoTags(roomId) {
    return this.request('GET', `/rooms/${roomId}/tags/todo`);
  }

  getAllTags(limit = 30) {
    return this.request('GET', `/tags/all?limit=${limit}`);
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

  // Home
  getPortalLinks() {
    return this.request('GET', '/rooms/portal-links');
  }

  // Message publish
  togglePublish(roomId, messageId, isPublished) {
    return this.request('PATCH', `/rooms/${roomId}/messages/${messageId}/publish`, { is_published: isPublished });
  }

  // Message edit
  editMessage(roomId, messageId, content) {
    return this.request('PUT', `/rooms/${roomId}/messages/${messageId}`, { content });
  }

  getMessageEdits(roomId, messageId) {
    return this.request('GET', `/rooms/${roomId}/messages/${messageId}/edits`);
  }

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

  // Portal Links (admin)
  getAdminPortalLinks() {
    return this.request('GET', '/admin/portal-links');
  }

  createPortalLink(data) {
    return this.request('POST', '/admin/portal-links', data);
  }

  updatePortalLink(id, data) {
    return this.request('PUT', `/admin/portal-links/${id}`, data);
  }

  deletePortalLink(id) {
    return this.request('DELETE', `/admin/portal-links/${id}`);
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

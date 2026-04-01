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
  uploadMedia(roomId, files, onProgress) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      const fileArray = Array.isArray(files) ? files : [files];
      for (const file of fileArray) {
        formData.append('files', file);
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/rooms/${roomId}/media`);
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

  async uploadRoomIcon(roomId, file) {
    const formData = new FormData();
    formData.append('icon', file);
    const res = await fetch(`${API_BASE}/rooms/${roomId}/icon`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'アップロードに失敗しました');
    return data;
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
    return new Promise((resolve, reject) => {
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      const formData = new FormData();
      if (replyTo) formData.append('reply_to', replyTo);
      formData.append('voice', blob, `voice.${ext}`);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/rooms/${roomId}/voice`);
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
          reject(new Error(data.error || '音声送信に失敗しました'));
        }
      };

      xhr.onerror = () => reject(new Error('音声送信に失敗しました'));
      xhr.send(formData);
    });
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

import { create } from 'zustand';
import { api } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';

export const useAuthStore = create((set) => ({
  user: null,
  isLoading: true,

  initialize: async () => {
    const token = localStorage.getItem('dashboard_token');
    if (!token) {
      set({ isLoading: false });
      return;
    }
    try {
      api.setToken(token);
      const data = await api.getMe();
      if (data.user.role !== 'admin') {
        api.setToken(null);
        set({ user: null, isLoading: false });
        return;
      }
      connectSocket(token);
      set({ user: data.user, isLoading: false });
    } catch {
      api.setToken(null);
      set({ user: null, isLoading: false });
    }
  },

  login: async (loginId, password) => {
    const data = await api.login(loginId, password);
    if (data.user.role !== 'admin') {
      throw new Error('管理者権限が必要です');
    }
    localStorage.setItem('dashboard_token', data.token);
    api.setToken(data.token);
    connectSocket(data.token);
    set({ user: data.user });
  },

  logout: () => {
    localStorage.removeItem('dashboard_token');
    api.setToken(null);
    disconnectSocket();
    set({ user: null });
  },
}));

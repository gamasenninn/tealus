import { create } from 'zustand';
import { api } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';

export const useAuthStore = create((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  isLoading: true,

  initialize: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ isLoading: false });
      return;
    }
    try {
      api.setToken(token);
      const data = await api.getMe();
      connectSocket(token);
      set({ user: data.user, token, isLoading: false });
    } catch {
      localStorage.removeItem('token');
      api.setToken(null);
      set({ user: null, token: null, isLoading: false });
    }
  },

  login: async (employee_id, password) => {
    const data = await api.login(employee_id, password);
    api.setToken(data.token);
    connectSocket(data.token);
    set({ user: data.user, token: data.token });
    return data;
  },

  logout: () => {
    api.setToken(null);
    disconnectSocket();
    set({ user: null, token: null });
  },
}));

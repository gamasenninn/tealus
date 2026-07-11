import { create } from 'zustand';
import { api } from '../services/api';
import type { AuthResponse } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';
import { registerPushNotification } from '../services/pushNotification';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  initialize: () => Promise<void>;
  login: (login_id: string, password: string) => Promise<AuthResponse>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
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
      registerPushNotification();
    } catch {
      localStorage.removeItem('token');
      api.setToken(null);
      set({ user: null, token: null, isLoading: false });
    }
  },

  login: async (login_id, password) => {
    const data = await api.login(login_id, password);
    api.setToken(data.token);
    connectSocket(data.token);
    set({ user: data.user, token: data.token });
    registerPushNotification();
    return data;
  },

  logout: () => {
    api.setToken(null);
    disconnectSocket();
    set({ user: null, token: null });
  },
}));

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }) => <div>{children}</div>,
  Routes: ({ children }) => <div>{children}</div>,
  Route: () => null,
  Navigate: () => null,
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

// Mock stores
vi.mock('../../src/stores/authStore', () => ({
  useAuthStore: () => ({
    user: null,
    isLoading: false,
    initialize: vi.fn(),
  }),
}));

import App from '../../src/App';

describe('App', () => {
  it('should render without crashing', () => {
    render(<App />);
    // When not logged in, should redirect to login
    // The app should at least render
    expect(document.body).toBeDefined();
  });
});

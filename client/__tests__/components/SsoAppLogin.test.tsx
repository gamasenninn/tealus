/**
 * ブラウザから「Tealus でログイン」の画面 /sso/app-login (docs/11 §5.5、2026-11-17)
 * - ログインしていなければ、ログイン画面へ (ログインのあと同じページに戻る)
 * - していれば口を呼び、返った戻り先へ移る (戻り先は本体の許可表が持つ。画面は URL から受け取らない)
 * - 枠 (iframe) の中では動かない
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../src/services/api', () => ({ api: { getAppLogin: vi.fn() } }));
const authState: { user: unknown; isLoading: boolean } = { user: { id: 'u1' }, isLoading: false };
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: () => authState }));

import { api } from '../../src/services/api';
import SsoAppLogin from '../../src/components/auth/SsoAppLogin';
import { safeNextPath } from '../../src/utils/safeNext';

const getAppLogin = vi.mocked(api.getAppLogin);
const STATE = '0123456789abcdef0123456789abcdef';
const AUD = 'https://portal.example.com';
const PATH = `/sso/app-login?aud=${encodeURIComponent(AUD)}&state=${STATE}`;

function LoginProbe() {
  const loc = useLocation();
  return <div data-testid="login">{loc.pathname + loc.search}</div>;
}

function renderAt(path: string, props: { go?: (u: string) => void; framed?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sso/app-login" element={<SsoAppLogin {...props} />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SsoAppLogin', () => {
  beforeEach(() => {
    getAppLogin.mockReset();
    authState.user = { id: 'u1' };
    authState.isLoading = false;
  });

  it('★ ログイン済みでも、押すまでは口を呼ばない (リンクを踏ませるだけで札を出さない。Fable の点検 中-1)', () => {
    renderAt(PATH, { go: vi.fn(), framed: false });
    expect(screen.getByRole('button', { name: /portal\.example\.com にログイン/ })).toBeInTheDocument();
    expect(getAppLogin).not.toHaveBeenCalled();
  });

  it('★ ボタンを押したら口を呼び、返った URL へ移る', async () => {
    getAppLogin.mockResolvedValue({ url: `${AUD}/auth/?a=tcallback&tealus_login=v1.a.b` });
    const go = vi.fn();
    renderAt(PATH, { go, framed: false });
    fireEvent.click(screen.getByRole('button', { name: /にログイン/ }));
    await waitFor(() => expect(go).toHaveBeenCalledWith(`${AUD}/auth/?a=tcallback&tealus_login=v1.a.b`));
    expect(getAppLogin).toHaveBeenCalledWith(AUD, STATE);
  });

  it('★ ログインしていなければ、このページへ戻る印を付けてログイン画面へ', async () => {
    authState.user = null;
    renderAt(PATH, { go: vi.fn(), framed: false });
    const login = await screen.findByTestId('login');
    const next = new URLSearchParams(login.textContent!.split('?')[1]).get('next');
    expect(next).toBe(PATH);
    expect(getAppLogin).not.toHaveBeenCalled();
  });

  it('★ 枠の中では動かない (口を呼ばない)', () => {
    const go = vi.fn();
    renderAt(PATH, { go, framed: true });
    expect(screen.getByText(/枠の中/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(getAppLogin).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it('aud・state の形が崩れていたら口を呼ばずに案内', () => {
    for (const p of ['/sso/app-login', `/sso/app-login?aud=${AUD}&state=xyz`, `/sso/app-login?state=${STATE}`]) {
      const { unmount } = renderAt(p, { go: vi.fn(), framed: false });
      expect(screen.getByText(/開き方が正しくありません/)).toBeInTheDocument();
      unmount();
    }
    expect(getAppLogin).not.toHaveBeenCalled();
  });

  it('口が断ったら案内を出し、よそへは移らない', async () => {
    getAppLogin.mockRejectedValue(new Error('このサイトにはログインの札を出せません'));
    const go = vi.fn();
    renderAt(PATH, { go, framed: false });
    fireEvent.click(screen.getByRole('button', { name: /にログイン/ }));
    expect(await screen.findByText(/ログインの札を出せません/)).toBeInTheDocument();
    expect(go).not.toHaveBeenCalled();
  });
});

describe('safeNextPath (ログインのあとに戻る先)', () => {
  it('アプリの中のパスだけ通す', () => {
    expect(safeNextPath(PATH)).toBe(PATH);
    expect(safeNextPath('/rooms/abc')).toBe('/rooms/abc');
  });
  it('★ よそへ出る形は / に倒す', () => {
    // ★ ブラウザは URL のタブ・改行を取り除くので、/\t/evil は //evil と読まれる (Fable の点検 低-2)
    for (const bad of [null, '', 'https://evil.example.com', '//evil.example.com', '/\\evil.example.com', 'javascript:alert(1)', 'rooms',
      '/\t/evil.example.com', '/\n/evil.example.com', '/\r/evil.example.com']) {
      expect(safeNextPath(bad)).toBe('/');
    }
  });
});

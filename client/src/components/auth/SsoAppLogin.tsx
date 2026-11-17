import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import './Login.css';

const STATE_RE = /^[0-9a-f]{32}$/;

function isFramed(): boolean {
  try { return window.self !== window.top; } catch { return true; }   // よそのサイトの枠の中では top を読めない
}

interface Props {
  /** 移り方 (試験で差し替える)。★ 履歴に残さない (戻るで札つきの URL に戻らない) */
  go?: (url: string) => void;
  /** 枠の中か (試験で差し替える) */
  framed?: boolean;
}

/**
 * ブラウザから「Tealus でログイン」(docs/11 §5.5、2026-11-17)。相手のサイトから
 * `/sso/app-login?aud=<相手の origin>&state=<合言葉>` で来る。
 * - ログインしていなければ、ログイン画面へ (ログインのあとこのページに戻る)
 * - していれば口 (POST /api/sso/app-login) を呼び、返った戻り先へ移る。★ 戻り先は本体の許可表が持つ (URL から受け取らない)
 * - ★ 枠 (iframe) の中では動かない (Tealus には X-Frame-Options が無いので、よそのページに埋めて押させる形を断つ)
 */
function SsoAppLogin({ go = (u) => window.location.replace(u), framed = isFramed() }: Props) {
  const { user, isLoading } = useAuthStore();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const aud = params.get('aud') ?? '';
  const state = params.get('state') ?? '';
  const valid = aud.startsWith('https://') && STATE_RE.test(state);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (framed || !valid || isLoading || !user) return;
    let current = true;
    api.getAppLogin(aud, state)
      .then((r) => { if (current) go(r.url); })
      .catch((e: unknown) => { if (current) setError(e instanceof Error ? e.message : String(e)); });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go は毎回作られるので見ない
  }, [framed, valid, isLoading, user, aud, state]);

  let message: string;
  if (framed) message = 'このページは枠の中では開けません。ブラウザで直接開いてください。';
  else if (!valid) message = 'ログインの開き方が正しくありません。元のサイトからもう一度「Tealus でログイン」を押してください。';
  else if (error) message = `${error}。元のサイトからもう一度お試しください。`;
  else if (isLoading) message = '読み込み中...';
  else if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  else message = 'ログインしています...';

  return (
    <div className="login-container">
      <div className="login-card">
        <img src="/logo.png" alt="Tealus" className="login-logo" />
        <h1 className="login-title">Tealus</h1>
        <p className="login-subtitle">{message}</p>
      </div>
    </div>
  );
}

export default SsoAppLogin;

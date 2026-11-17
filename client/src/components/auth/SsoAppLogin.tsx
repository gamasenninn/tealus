import { useEffect, useRef, useState } from 'react';
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
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // ★ 押すまでは口を呼ばない (2026-11-17 Fable の点検 中-1)。自動で呼ぶと、攻撃者が始めた state のリンクを
  //   踏ませるだけで本人の札が出る。守りが「札が 90 秒漏れないこと」だけになる
  const confirm = () => {
    setSending(true);
    api.getAppLogin(aud, state)
      .then((r) => { if (mounted.current) go(r.url); })
      .catch((e: unknown) => {
        if (!mounted.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setSending(false);
      });
  };

  let host = '';
  try { host = new URL(aud).host; } catch { /* valid で弾く */ }

  let message: string;
  if (framed) message = 'このページは枠の中では開けません。ブラウザで直接開いてください。';
  else if (!valid || !host) message = 'ログインの開き方が正しくありません。元のサイトからもう一度「Tealus でログイン」を押してください。';
  else if (error) message = `${error}。元のサイトからもう一度お試しください。`;
  else if (isLoading) message = '読み込み中...';
  else if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  else message = `Tealus の ID で ${host} にログインします。自分で開いたページでなければ、押さずに閉じてください。`;

  const showButton = !framed && valid && !!host && !error && !isLoading && !!user;

  return (
    <div className="login-container">
      <div className="login-card">
        <img src="/logo.png" alt="Tealus" className="login-logo" />
        <h1 className="login-title">Tealus</h1>
        <p className="login-subtitle">{message}</p>
        {showButton && (
          <button type="button" className="login-button" onClick={confirm} disabled={sending}>
            {sending ? 'ログインしています...' : `${host} にログインする`}
          </button>
        )}
      </div>
    </div>
  );
}

export default SsoAppLogin;

import { useState } from 'react';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';

const PASSWORD_MIN = 8;   // 本体の utils/userFields.mts と同じ

/**
 * 管理者が作った人・管理者がパスワードを入れ直した人は、変えるまでこの画面だけを出す
 * (2026-10-29 小野さん判断 7、docs/02 users.must_change_password)。
 * ★ 以前は管理者が決めた仮パスワードのまま使い続けられた。★ 本体は他の口を止めない (画面の案内であって鍵ではない)
 */
function ForcePasswordChange() {
  const { user, setUser, logout } = useAuthStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ([...next].length < PASSWORD_MIN) { setError(`新しいパスワードは ${PASSWORD_MIN} 文字以上にしてください`); return; }
    if (next !== again) { setError('新しいパスワードが確認と一致しません'); return; }
    setSaving(true);
    setError('');
    try {
      await api.changePassword(current, next);
      if (user) setUser({ ...user, must_change_password: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="loading force-pw">
      <form className="force-pw-form" onSubmit={submit}>
        <p className="force-pw-title">はじめに、パスワードを変えてください</p>
        <p className="force-pw-sub">いまのパスワードは管理者が決めたものです。自分だけが知っているものに変えると使い始められます。</p>
        <label htmlFor="force-pw-current">いまのパスワード</label>
        <input id="force-pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label htmlFor="force-pw-next">新しいパスワード (8 文字以上)</label>
        <input id="force-pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <label htmlFor="force-pw-again">新しいパスワード (確認)</label>
        <input id="force-pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        {error && <p className="force-pw-error">{error}</p>}
        <button type="submit" disabled={saving}>変更する</button>
        <button type="button" className="force-pw-logout" onClick={() => { void logout().finally(() => window.location.assign('/login')); }}>ログアウト</button>
      </form>
    </div>
  );
}

export default ForcePasswordChange;

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

function Login() {
  const { login } = useAuthStore();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      await login(loginId, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Tealus Dashboard</h1>
        <p className="login-subtitle">システム管理（管理者専用）</p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <label>ユーザーID</label>
            <input value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="user001" required />
          </div>
          <div className="login-field">
            <label>パスワード</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required />
          </div>
          <button type="submit" disabled={isSubmitting} className="login-btn">
            {isSubmitting ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';
import './Profile.css';

function Profile() {
  const { user, initialize } = useAuthStore();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [statusMessage, setStatusMessage] = useState(user?.status_message || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [chatFontSize, setChatFontSize] = useState(localStorage.getItem('chatFontSize') || 'medium');

  const showMessage = (msg) => {
    setMessage(msg);
    setError('');
    setTimeout(() => setMessage(''), 3000);
  };

  const showError = (msg) => {
    setError(msg);
    setMessage('');
  };

  const handleProfileSave = async () => {
    setSaving(true);
    try {
      await api.updateProfile({ display_name: displayName, status_message: statusMessage });
      await initialize();
      showMessage('プロフィールを更新しました');
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await api.uploadAvatar(file);
      await initialize();
      showMessage('プロフィール画像を更新しました');
    } catch (err) {
      showError(err.message);
    }
    e.target.value = '';
  };

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword) {
      showError('現在のパスワードと新しいパスワードを入力してください');
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      showMessage('パスワードを変更しました');
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFontSizeChange = (size) => {
    setChatFontSize(size);
    localStorage.setItem('chatFontSize', size);
    document.documentElement.setAttribute('data-chat-font', size === 'medium' ? '' : size);
  };

  const avatarSrc = user?.avatar_url ? `/media/${user.avatar_url}` : null;

  return (
    <div className="profile-container">
      <header className="profile-header">
        <button className="profile-back-btn" onClick={() => navigate('/')}>← 戻る</button>
        <h1>プロフィール</h1>
      </header>

      {message && <div className="profile-message success">{message}</div>}
      {error && <div className="profile-message error">{error}</div>}

      <div className="profile-section">
        <div className="profile-avatar-area" onClick={handleAvatarClick}>
          {avatarSrc ? (
            <img src={avatarSrc} alt="avatar" className="profile-avatar-img" />
          ) : (
            <div className="profile-avatar-placeholder">
              {user?.display_name?.charAt(0) || '?'}
            </div>
          )}
          <div className="profile-avatar-overlay">変更</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            hidden
          />
        </div>
        <div className="profile-employee-id">{user?.employee_id}</div>
      </div>

      <div className="profile-section">
        <h2>基本情報</h2>
        <div className="profile-field">
          <label>表示名</label>
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="表示名"
          />
        </div>
        <div className="profile-field">
          <label>ステータスメッセージ</label>
          <input
            value={statusMessage}
            onChange={e => setStatusMessage(e.target.value)}
            placeholder="ひとこと"
            maxLength={100}
          />
        </div>
        <button className="profile-save-btn" onClick={handleProfileSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      <div className="profile-section">
        <h2>パスワード変更</h2>
        <div className="profile-field">
          <label>現在のパスワード</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            placeholder="現在のパスワード"
          />
        </div>
        <div className="profile-field">
          <label>新しいパスワード</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="新しいパスワード"
          />
        </div>
        <button className="profile-save-btn" onClick={handlePasswordChange} disabled={saving}>
          {saving ? '変更中...' : 'パスワード変更'}
        </button>
      </div>

      <div className="profile-section">
        <h2>トーク文字サイズ</h2>
        <div className="font-size-options">
          {[
            { value: 'small', label: '小' },
            { value: 'medium', label: '中' },
            { value: 'large', label: '大' },
          ].map(opt => (
            <button
              key={opt.value}
              className={`font-size-btn ${chatFontSize === opt.value ? 'active' : ''}`}
              onClick={() => handleFontSizeChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="font-size-preview" style={{ fontSize: chatFontSize === 'small' ? '13px' : chatFontSize === 'large' ? '17px' : '15px' }}>
          プレビュー: こんにちは、Linnyです。
        </p>
      </div>
    </div>
  );
}

export default Profile;

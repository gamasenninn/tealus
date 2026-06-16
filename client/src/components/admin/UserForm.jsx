import { useState } from 'react';

function UserForm({ user, onSubmit, onCancel }) {
  const isEdit = !!user;
  const [formData, setFormData] = useState({
    login_id: user?.login_id || '',
    display_name: user?.display_name || '',
    password: '',
    role: user?.role || 'user',
    is_bot: user?.is_bot || false,
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const data = {};
      if (!isEdit) {
        data.login_id = formData.login_id;
        data.password = formData.password;
      }
      if (!isEdit || formData.display_name !== user.display_name) {
        data.display_name = formData.display_name;
      }
      if (!isEdit || formData.role !== user.role) {
        data.role = formData.role;
      }
      if (isEdit && formData.password) {
        data.password = formData.password;
      }
      if (!isEdit || formData.is_bot !== user.is_bot) {
        data.is_bot = formData.is_bot;
      }

      await onSubmit(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="user-form" autoComplete="off">
      <h2>{isEdit ? 'ユーザー編集' : 'ユーザー追加'}</h2>

      {error && <div className="form-error">{error}</div>}

      <div className="form-field">
        <label>ユーザーID</label>
        <input
          name="login_id"
          value={formData.login_id}
          onChange={handleChange}
          disabled={isEdit}
          required={!isEdit}
          placeholder="例: EMP001"
          autoComplete="off"
        />
      </div>

      <div className="form-field">
        <label>表示名</label>
        <input
          name="display_name"
          value={formData.display_name}
          onChange={handleChange}
          required
          placeholder="例: 田中太郎"
        />
      </div>

      <div className="form-field">
        <label>{isEdit ? 'パスワード（変更する場合のみ）' : 'パスワード'}</label>
        <input
          name="password"
          type="password"
          value={formData.password}
          onChange={handleChange}
          required={!isEdit}
          placeholder={isEdit ? '未入力なら変更なし' : 'パスワード'}
          autoComplete="new-password"
        />
      </div>

      <div className="form-field">
        <label>権限</label>
        <select name="role" value={formData.role} onChange={handleChange}>
          <option value="user">一般</option>
          <option value="admin">管理者</option>
          <option value="guest">ゲスト</option>
        </select>
      </div>

      <div className="form-field">
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            name="is_bot"
            checked={formData.is_bot}
            onChange={(e) => setFormData({ ...formData, is_bot: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }}
          />
          AIエージェント
        </label>
      </div>

      <div className="form-buttons">
        <button type="button" className="cancel-btn" onClick={onCancel}>キャンセル</button>
        <button type="submit" className="submit-btn" disabled={submitting}>
          {submitting ? '処理中...' : (isEdit ? '更新' : '作成')}
        </button>
      </div>
    </form>
  );
}

export default UserForm;

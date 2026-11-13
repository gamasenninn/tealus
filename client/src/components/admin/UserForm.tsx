import { useState } from 'react';
import type { User } from '../../types';

// AdminDashboard へ渡す送信 payload (作成時は login_id/password、編集時は差分のみ)
type AdminUserPayload = Partial<User> & { password?: string };

interface UserFormProps {
  user: User | null;
  onSubmit: (data: AdminUserPayload) => Promise<void>;
  onCancel: () => void;
}

function UserForm({ user, onSubmit, onCancel }: UserFormProps) {
  const isEdit = !!user;
  const [formData, setFormData] = useState({
    login_id: user?.login_id || '',
    display_name: user?.display_name || '',
    password: '',
    role: user?.role || 'user',
    is_bot: user?.is_bot || false,
    is_external_contact: user?.is_external_contact || false,
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const data: AdminUserPayload = {};
      if (!isEdit) {
        data.login_id = formData.login_id;
        data.password = formData.password;
      }
      if (!isEdit || formData.display_name !== user!.display_name) {
        data.display_name = formData.display_name;
      }
      if (!isEdit || formData.role !== user!.role) {
        data.role = formData.role;
      }
      if (isEdit && formData.password) {
        data.password = formData.password;
      }
      if (!isEdit || formData.is_bot !== user!.is_bot) {
        data.is_bot = formData.is_bot;
      }
      if (isEdit && formData.is_external_contact !== (user!.is_external_contact || false)) {
        data.is_external_contact = formData.is_external_contact;
      }

      await onSubmit(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          placeholder={isEdit ? '未入力なら変更なし (変えるなら 8 文字以上)' : '8 文字以上'}
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

      {/* ★ 2026-11-13 社外の窓口 (docs/02 users.is_external_contact)。この口座がいる部屋がトーク一覧の「お客様」のタブに入る。
          既にある口座に付けるものなので、編集のときだけ出す */}
      {isEdit && (
        <div className="form-field">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              name="is_external_contact"
              checked={formData.is_external_contact}
              onChange={(e) => setFormData({ ...formData, is_external_contact: e.target.checked })}
              style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }}
            />
            社外の窓口 (この口座がいる部屋を「お客様」のタブにまとめる)
          </label>
        </div>
      )}

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

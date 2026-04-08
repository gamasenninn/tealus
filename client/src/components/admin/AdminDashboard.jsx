import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';
import UserForm from './UserForm';
import WebhookManager from './WebhookManager';
import ContextMenu from '../chat/ContextMenu';
import './AdminDashboard.css';

function AdminDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [error, setError] = useState('');
  const [contextMenu, setContextMenu] = useState(null);

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/');
      return;
    }
    loadUsers();
  }, [user, navigate]);

  const loadUsers = async () => {
    try {
      const data = await api.getAdminUsers();
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (formData) => {
    try {
      await api.createAdminUser(formData);
      setShowCreateForm(false);
      await loadUsers();
    } catch (err) {
      throw err;
    }
  };

  const handleUpdate = async (formData) => {
    try {
      await api.updateAdminUser(editingUser.id, formData);
      setEditingUser(null);
      await loadUsers();
    } catch (err) {
      throw err;
    }
  };

  const handleToggleActive = async (targetUser) => {
    try {
      await api.updateAdminUserStatus(targetUser.id, !targetUser.is_active);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="admin-loading">読み込み中...</div>;

  return (
    <div className="admin-container">
      <header className="admin-header">
        <div className="admin-header-left">
          <button className="admin-back-btn" onClick={() => navigate('/')}>←</button>
          <h1>管理ダッシュボード</h1>
        </div>
      </header>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>ユーザー</button>
        <button className={`admin-tab ${activeTab === 'webhooks' ? 'active' : ''}`} onClick={() => setActiveTab('webhooks')}>Webhook</button>
      </div>

      {activeTab === 'webhooks' ? (
        <WebhookManager />
      ) : (
      <>
      <div className="admin-section-header">
        <h2>ユーザー管理</h2>
        <button className="admin-create-btn" onClick={() => { setShowCreateForm(true); setEditingUser(null); }}>
          + ユーザー追加
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {(showCreateForm || editingUser) && (
        <div className="admin-modal-overlay" onClick={() => { setShowCreateForm(false); setEditingUser(null); }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <UserForm
              user={editingUser}
              onSubmit={editingUser ? handleUpdate : handleCreate}
              onCancel={() => { setShowCreateForm(false); setEditingUser(null); }}
            />
          </div>
        </div>
      )}

      <div className="admin-user-list">
        <table>
          <thead>
            <tr>
              <th>社員番号</th>
              <th>表示名</th>
              <th>権限</th>
              <th>状態</th>
              <th>作成日</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className={!u.is_active ? 'inactive-row' : ''}>
                <td>{u.employee_id}</td>
                <td>{u.display_name}</td>
                <td><span className={`role-badge ${u.role}`}>{u.role === 'admin' ? '管理者' : '一般'}</span></td>
                <td><span className={`status-badge ${u.is_active ? 'active' : 'inactive'}`}>{u.is_active ? '有効' : '無効'}</span></td>
                <td>{new Date(u.created_at).toLocaleDateString('ja-JP')}</td>
                <td className="admin-actions">
                  <button className="kebab-btn" onClick={(e) => {
                    setContextMenu({
                      x: e.clientX, y: e.clientY,
                      items: [
                        { icon: '✏', label: '編集', onClick: () => { setEditingUser(u); setShowCreateForm(false); } },
                        { icon: u.is_active ? '🚫' : '✅', label: u.is_active ? '無効化' : '有効化', onClick: () => handleToggleActive(u), danger: u.is_active },
                      ],
                    });
                  }}>⋮</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      )}

      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

export default AdminDashboard;

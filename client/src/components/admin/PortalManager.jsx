import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import ContextMenu from '../chat/ContextMenu';
import { Pencil, Trash2 } from 'lucide-react';

function PortalManager() {
  const [links, setLinks] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [contextMenu, setContextMenu] = useState(null);

  const [formTitle, setFormTitle] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formIcon, setFormIcon] = useState('');

  useEffect(() => { loadLinks(); }, []);

  const loadLinks = async () => {
    try {
      const data = await api.getAdminPortalLinks();
      setLinks(data.links);
    } catch (err) {
      setError(err.message);
    }
  };

  const resetForm = () => {
    setFormTitle('');
    setFormUrl('');
    setFormIcon('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = { title: formTitle, url: formUrl, icon: formIcon || null };
      if (editingId) {
        await api.updatePortalLink(editingId, data);
      } else {
        await api.createPortalLink(data);
      }
      setShowForm(false);
      setEditingId(null);
      resetForm();
      await loadLinks();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = (link) => {
    setFormTitle(link.title);
    setFormUrl(link.url);
    setFormIcon(link.icon || '');
    setEditingId(link.id);
    setShowForm(true);
  };

  const handleDelete = async (link) => {
    if (!confirm(`「${link.title}」を削除しますか？`)) return;
    try {
      await api.deletePortalLink(link.id);
      await loadLinks();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="admin-section-header">
        <h2>ポータルリンク管理</h2>
        <button className="admin-create-btn" onClick={() => { setShowForm(true); setEditingId(null); resetForm(); }}>
          + リンク追加
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {showForm && (
        <div className="admin-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>{editingId ? 'リンク編集' : 'リンク登録'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>タイトル *</label>
                <input type="text" value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="勤怠システム" required />
              </div>
              <div className="form-group">
                <label>URL *</label>
                <input type="url" value={formUrl} onChange={e => setFormUrl(e.target.value)} placeholder="https://example.com" required />
              </div>
              <div className="form-group">
                <label>アイコン（絵文字、任意）</label>
                <input type="text" value={formIcon} onChange={e => setFormIcon(e.target.value)} placeholder="📋" />
              </div>
              <div className="form-actions">
                <button type="submit" className="admin-create-btn">{editingId ? '更新' : '登録'}</button>
                <button type="button" className="admin-cancel-btn" onClick={() => { setShowForm(false); setEditingId(null); }}>キャンセル</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="admin-user-list">
        <table>
          <thead>
            <tr>
              <th>タイトル</th>
              <th>URL</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {links.length === 0 ? (
              <tr><td colSpan="4" style={{ textAlign: 'center', color: '#999', padding: '24px' }}>ポータルリンクが登録されていません</td></tr>
            ) : (
              links.map(l => (
                <tr key={l.id} className={!l.is_active ? 'inactive-row' : ''}>
                  <td>{l.icon && `${l.icon} `}{l.title}</td>
                  <td style={{ wordBreak: 'break-all', maxWidth: '200px' }}>{l.url}</td>
                  <td>
                    <span className={`status-badge ${l.is_active ? 'active' : 'inactive'}`}>
                      {l.is_active ? '有効' : '無効'}
                    </span>
                  </td>
                  <td className="admin-actions">
                    <button className="kebab-btn" onClick={(e) => {
                      setContextMenu({
                        x: e.clientX, y: e.clientY,
                        items: [
                          { icon: <Pencil size={16} />, label: '編集', onClick: () => handleEdit(l) },
                          { icon: <Trash2 size={16} />, label: '削除', onClick: () => handleDelete(l), danger: true },
                        ],
                      });
                    }}>⋮</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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

export default PortalManager;

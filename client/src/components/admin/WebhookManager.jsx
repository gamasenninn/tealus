import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import ContextMenu from '../chat/ContextMenu';
import { Pencil, Bell, Ban, CheckCircle, Trash2 } from 'lucide-react';

const EVENT_OPTIONS = [
  { value: 'message.created', label: 'メッセージ作成' },
  { value: 'message.deleted', label: 'メッセージ削除' },
  { value: 'message.updated', label: 'メッセージ編集' },
  { value: 'voice.transcription_completed', label: '音声文字起こし完了' },
  { value: 'member.joined', label: 'メンバー追加' },
  { value: 'member.left', label: 'メンバー退出' },
  { value: 'reaction.added', label: 'リアクション追加' },
];

function WebhookManager() {
  const [webhooks, setWebhooks] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [testResults, setTestResults] = useState({});
  const [contextMenu, setContextMenu] = useState(null);

  // Form state
  const [formUrl, setFormUrl] = useState('');
  const [formRoomId, setFormRoomId] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [formEvents, setFormEvents] = useState(['message.created']);

  useEffect(() => {
    loadWebhooks();
    loadRooms();
  }, []);

  const loadWebhooks = async () => {
    try {
      const data = await api.getWebhooks();
      setWebhooks(data.webhooks);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadRooms = async () => {
    try {
      const data = await api.getRooms();
      setRooms(data.rooms);
    } catch (err) { /* ignore */ }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = {
        url: formUrl,
        room_id: formRoomId || null,
        events: formEvents,
      };
      if (formSecret) data.secret = formSecret;

      if (editingId) {
        await api.updateWebhook(editingId, data);
      } else {
        await api.createWebhook(data);
      }
      setShowForm(false);
      setEditingId(null);
      resetForm();
      await loadWebhooks();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = (webhook) => {
    setFormUrl(webhook.url);
    setFormRoomId(webhook.room_id || '');
    setFormSecret('');
    setFormEvents(webhook.events || ['message.created']);
    setEditingId(webhook.id);
    setShowForm(true);
  };

  const resetForm = () => {
    setFormUrl('');
    setFormRoomId('');
    setFormSecret('');
    setFormEvents(['message.created']);
  };

  const handleToggleActive = async (webhook) => {
    try {
      await api.updateWebhook(webhook.id, { is_active: !webhook.is_active });
      await loadWebhooks();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (webhook) => {
    if (!confirm(`Webhook「${webhook.url}」を削除しますか？`)) return;
    try {
      await api.deleteWebhook(webhook.id);
      await loadWebhooks();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTest = async (webhook) => {
    setTestResults(prev => ({ ...prev, [webhook.id]: 'sending' }));
    try {
      const result = await api.testWebhook(webhook.id);
      setTestResults(prev => ({ ...prev, [webhook.id]: result.success ? `OK (${result.status})` : `NG (${result.status})` }));
    } catch (err) {
      setTestResults(prev => ({ ...prev, [webhook.id]: 'NG (接続失敗)' }));
    }
  };

  const toggleEvent = (eventValue) => {
    setFormEvents(prev =>
      prev.includes(eventValue)
        ? prev.filter(e => e !== eventValue)
        : [...prev, eventValue]
    );
  };

  return (
    <div>
      <div className="admin-section-header">
        <h2>Webhook管理</h2>
        <button className="admin-create-btn" onClick={() => { setShowForm(true); setEditingId(null); resetForm(); }}>
          + Webhook追加
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {showForm && (
        <div className="admin-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>{editingId ? 'Webhook編集' : 'Webhook登録'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>URL *</label>
                <input type="url" value={formUrl} onChange={e => setFormUrl(e.target.value)} placeholder="https://example.com/webhook" required />
              </div>
              <div className="form-group">
                <label>対象ルーム（空欄=全ルーム）</label>
                <select value={formRoomId} onChange={e => setFormRoomId(e.target.value)}>
                  <option value="">全ルーム</option>
                  {rooms.map(r => (
                    <option key={r.id} value={r.id}>{r.name || 'DM'}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>シークレット（署名検証用、任意）</label>
                <input type="text" value={formSecret} onChange={e => setFormSecret(e.target.value)} placeholder={editingId ? '変更する場合のみ入力' : 'my-secret-key'} />
              </div>
              <div className="form-group">
                <label>イベント種別</label>
                <div className="event-checkboxes">
                  {EVENT_OPTIONS.map(opt => (
                    <label key={opt.value} className="event-checkbox">
                      <input type="checkbox" checked={formEvents.includes(opt.value)} onChange={() => toggleEvent(opt.value)} />
                      {opt.label}
                    </label>
                  ))}
                </div>
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
              <th>URL</th>
              <th>ルーム</th>
              <th>イベント</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.length === 0 ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', color: '#999', padding: '24px' }}>Webhookが登録されていません</td></tr>
            ) : (
              webhooks.map(w => (
                <tr key={w.id} className={!w.is_active ? 'inactive-row' : ''}>
                  <td style={{ wordBreak: 'break-all', maxWidth: '200px' }}>{w.url}</td>
                  <td>{w.room_name || '全ルーム'}</td>
                  <td>{w.events?.map(e => EVENT_OPTIONS.find(o => o.value === e)?.label || e).join(', ')}</td>
                  <td>
                    <span className={`status-badge ${w.is_active ? 'active' : 'inactive'}`}>
                      {w.is_active ? '有効' : '無効'}
                    </span>
                  </td>
                  <td className="admin-actions">
                    {testResults[w.id] && testResults[w.id] !== 'sending' && (
                      <span className={testResults[w.id].startsWith('OK') ? 'test-ok' : 'test-ng'}>
                        {testResults[w.id]}
                      </span>
                    )}
                    <button className="kebab-btn" onClick={(e) => {
                      setContextMenu({
                        x: e.clientX, y: e.clientY,
                        items: [
                          { icon: <Pencil size={16} />, label: '編集', onClick: () => handleEdit(w) },
                          { icon: <Bell size={16} />, label: testResults[w.id] === 'sending' ? '送信中...' : 'テスト送信', onClick: () => handleTest(w) },
                          { icon: w.is_active ? <Ban size={16} /> : <CheckCircle size={16} />, label: w.is_active ? '無効化' : '有効化', onClick: () => handleToggleActive(w) },
                          { icon: <Trash2 size={16} />, label: '削除', onClick: () => handleDelete(w), danger: true },
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

export default WebhookManager;

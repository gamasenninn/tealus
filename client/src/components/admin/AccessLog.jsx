import { useState, useEffect } from 'react';
import { api } from '../../services/api';

// 日時整形 (null は「—」)
function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// 最終アクティブ = 最終投稿 と 最終閲覧 の新しい方
function latest(a, b) {
  const ta = a ? new Date(a).getTime() : 0;
  const tb = b ? new Date(b).getTime() : 0;
  const t = Math.max(ta, tb);
  return t === 0 ? null : (ta >= tb ? a : b);
}

function roleLabel(u) {
  if (u.is_bot) return 'BOT';
  return u.role === 'admin' ? '管理者' : '一般';
}

function AccessLog() {
  const [users, setUsers] = useState([]);
  const [matrix, setMatrix] = useState([]);
  const [expanded, setExpanded] = useState(null); // 展開中の user_id
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const data = await api.getAdminAccessLog();
      setUsers(data.users || []);
      setMatrix(data.matrix || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ユーザの行クリックで、そのユーザのルーム別内訳を展開
  const roomsOf = (userId) =>
    matrix
      .filter(m => m.user_id === userId)
      .sort((a, b) => {
        const la = latest(a.last_post_at, a.last_view_at);
        const lb = latest(b.last_post_at, b.last_view_at);
        return new Date(lb || 0) - new Date(la || 0);
      });

  if (loading) return <div className="admin-loading">読み込み中...</div>;

  return (
    <div>
      <div className="admin-section-header">
        <h2>アクセスログ</h2>
        <button className="admin-create-btn" onClick={load}>更新</button>
      </div>

      <p style={{ color: '#888', fontSize: '13px', margin: '0 0 12px' }}>
        投稿は完全な履歴、閲覧は「最後に覗いた時刻」（既読カーソル由来のスナップショット）です。
        新着がないルームを開いただけではカーソルは進まないため、純粋な開封時刻とは多少ずれます。
        行をクリックするとルーム別の内訳が開きます。
      </p>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-user-list">
        <table>
          <thead>
            <tr>
              <th>表示名</th>
              <th>権限</th>
              <th>最終投稿</th>
              <th>最終閲覧</th>
              <th>最終アクティブ</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', color: '#999', padding: '24px' }}>データがありません</td></tr>
            ) : (
              users.map(u => {
                const isOpen = expanded === u.id;
                const rooms = isOpen ? roomsOf(u.id) : [];
                return [
                  <tr
                    key={u.id}
                    className={!u.is_active ? 'inactive-row' : ''}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setExpanded(isOpen ? null : u.id)}
                  >
                    <td>{isOpen ? '▾ ' : '▸ '}{u.display_name}</td>
                    <td><span className={`role-badge ${u.role}`}>{roleLabel(u)}</span></td>
                    <td>{fmt(u.last_post_at)}</td>
                    <td>{fmt(u.last_view_at)}</td>
                    <td>{fmt(latest(u.last_post_at, u.last_view_at))}</td>
                  </tr>,
                  isOpen && (
                    <tr key={u.id + '-detail'}>
                      <td colSpan="5" style={{ background: '#fafafa', padding: '0 0 0 24px' }}>
                        {rooms.length === 0 ? (
                          <div style={{ color: '#999', padding: '12px' }}>このユーザの投稿・閲覧はありません</div>
                        ) : (
                          <table style={{ width: '100%' }}>
                            <thead>
                              <tr>
                                <th>ルーム</th>
                                <th>最終投稿</th>
                                <th>最終閲覧</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rooms.map(m => (
                                <tr key={u.id + '-' + m.room_id}>
                                  <td>{m.room_name}</td>
                                  <td>{fmt(m.last_post_at)}</td>
                                  <td>{fmt(m.last_view_at)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ),
                ];
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AccessLog;

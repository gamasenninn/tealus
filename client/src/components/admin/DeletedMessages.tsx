import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { DeletedMessageEntry } from '../../services/api';

function fmt(ts: string) {
  return new Date(ts).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * 削除された投稿 (2026-10-30 利用者判断 3、docs/02 deleted_message_contents)。
 * ★ 削除しても本文は管理者だけが見られる所に残る。誤って消した投稿は「戻す」で元の場所に戻る
 *   (部屋を開いている人には、開き直したときに出る)
 */
function DeletedMessages() {
  const [items, setItems] = useState<DeletedMessageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setItems((await api.getAdminDeletedMessages()).messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const restore = async (item: DeletedMessageEntry) => {
    if (!window.confirm(`「${item.room_name ?? ''}」の ${item.sender_display_name} さんの投稿を戻しますか?`)) return;
    try {
      await api.restoreAdminDeletedMessage(item.message_id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) return <div className="admin-loading">読み込み中...</div>;

  return (
    <div>
      <div className="admin-section-header"><h2>削除された投稿</h2></div>
      <p>管理者のほかには見えません (消した本人にも見えません)。新しい順に 100 件まで。</p>
      {error && <div className="admin-error">{error}</div>}
      {items.length === 0 ? <p>削除された投稿はありません</p> : (
        <div className="admin-user-list"><table>
          <thead><tr><th>消した日時</th><th>部屋</th><th>送った人</th><th>消した人</th><th>本文</th><th></th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.message_id}>
                <td>{fmt(item.deleted_at)}</td>
                <td>{item.room_name ?? '(1 対 1)'}</td>
                <td>{item.sender_display_name}</td>
                <td>{item.deleted_by_display_name ?? '—'}</td>
                <td>{item.content ?? `(${item.type})`}</td>
                <td className="admin-actions"><button className="admin-create-btn" onClick={() => restore(item)}>戻す</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

export default DeletedMessages;

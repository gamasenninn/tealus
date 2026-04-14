import { useState, useEffect } from 'react';
import { api } from '../services/api';

function Rooms() {
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    api.getRooms().then(d => setRooms(d.rooms)).catch(() => {});
  }, []);

  return (
    <div className="page">
      <h2>ルーム管理</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>ルーム名</th>
            <th>タイプ</th>
            <th>メンバー数</th>
            <th>作成日</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map(r => (
            <tr key={r.id}>
              <td>{r.name || r.partner_display_name || 'DM'}</td>
              <td><span className={`badge ${r.type}`}>{r.type}</span></td>
              <td>{r.member_count}</td>
              <td>{new Date(r.created_at).toLocaleDateString('ja-JP')}</td>
            </tr>
          ))}
          {rooms.length === 0 && <tr><td colSpan={4} className="empty">ルームがありません</td></tr>}
        </tbody>
      </table>
      <p className="hint">エージェント設定は #105 で実装予定</p>
    </div>
  );
}

export default Rooms;

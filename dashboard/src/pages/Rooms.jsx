import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Settings } from 'lucide-react';

function Rooms() {
  const [rooms, setRooms] = useState([]);
  const navigate = useNavigate();

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
            <th>設定</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map(r => (
            <tr key={r.id}>
              <td>{r.name || r.partner_display_name || 'DM'}</td>
              <td><span className={`badge ${r.type}`}>{r.type}</span></td>
              <td>{r.member_count}</td>
              <td>{new Date(r.created_at).toLocaleDateString('ja-JP')}</td>
              <td>
                <button className="icon-btn" onClick={() => navigate(`/rooms/${r.id}`)} title="設定">
                  <Settings size={16} />
                </button>
              </td>
            </tr>
          ))}
          {rooms.length === 0 && <tr><td colSpan={5} className="empty">ルームがありません</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default Rooms;

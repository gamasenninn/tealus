import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { agentApi } from '../services/agentApi';
import { Settings } from 'lucide-react';

function Rooms() {
  const [rooms, setRooms] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    // エージェントが参加している全ルームを取得（admin のルームではなく）
    Promise.all([
      api.getRooms().then(d => d.rooms).catch(() => []),
      agentApi.getRoomsList().then(d => d.rooms || []).catch(() => []),
    ]).then(([apiRooms, agentRooms]) => {
      // API ルーム情報をマップ化
      const roomMap = new Map(apiRooms.map(r => [r.id, r]));
      // エージェントのルームを基準に、API 情報で補完
      const merged = agentRooms.map(ar => {
        const info = roomMap.get(ar.room_id);
        return {
          id: ar.room_id,
          name: info?.name || info?.partner_display_name || ar.room_id.slice(0, 8),
          type: info?.type || 'unknown',
          member_count: info?.member_count || '?',
          created_at: info?.created_at || '',
          response_mode: ar.response_mode,
          enabled: ar.enabled,
          tts_model_uuid: ar.tts_model_uuid,
        };
      });
      // エージェントが参加していないが API にあるルームも追加
      for (const r of apiRooms) {
        if (!merged.find(m => m.id === r.id)) {
          merged.push({
            id: r.id,
            name: r.name || r.partner_display_name || 'DM',
            type: r.type,
            member_count: r.member_count,
            created_at: r.created_at,
          });
        }
      }
      setRooms(merged);
    });
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

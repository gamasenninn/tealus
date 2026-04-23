import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { agentApi } from '../services/agentApi';
import { ArrowLeft, Settings } from 'lucide-react';

function AgentRooms() {
  const { agentId } = useParams();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [agentName, setAgentName] = useState('');

  useEffect(() => {
    // エージェント名を取得
    api.getAgents().then(d => {
      const agent = d.agents.find(a => a.id === agentId);
      if (agent) setAgentName(agent.display_name);
    }).catch(() => {});

    // エージェントのルーム一覧を取得
    agentApi.getAgentRooms(agentId).then(d => setRooms(d.rooms || [])).catch(() => {});
  }, [agentId]);

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="back-btn" onClick={() => navigate('/agents')}><ArrowLeft size={18} /></button>
          <h2>{agentName || 'エージェント'} のルーム設定</h2>
        </div>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>ルーム名</th>
            <th>タイプ</th>
            <th>メンバー数</th>
            <th>応答モード</th>
            <th>設定</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map(r => (
            <tr key={r.room_id}>
              <td>{r.name || r.room_id.slice(0, 8)}</td>
              <td><span className={`badge ${r.type}`}>{r.type}</span></td>
              <td>{r.member_count || '?'}</td>
              <td><span className={`badge ${r.enabled === false ? 'inactive' : 'active'}`}>{r.response_mode || 'auto'}</span></td>
              <td>
                <button className="icon-btn" onClick={() => navigate(`/agents/${agentId}/rooms/${r.room_id}`)} title="設定">
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

export default AgentRooms;

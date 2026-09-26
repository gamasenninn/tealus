import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { agentApi } from '../services/agentApi';
import type { User } from '../services/api';
import { Settings, MessageSquare } from 'lucide-react';

function Agents() {
  const [agents, setAgents] = useState<User[]>([]);
  // ★ 2026-09-26: エージェントごとのルーム数。取れなかったら null (= 今までどおりのボタンを出す)
  const [roomCounts, setRoomCounts] = useState<Record<string, number> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.getAgents().then(d => setAgents(d.agents)).catch(() => {});
    agentApi.getAgentRoomCounts().then(d => setRoomCounts(d.counts)).catch(() => {});
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <h2>エージェント管理</h2>
        <button className="header-btn" onClick={() => navigate('/agents/settings')}>
          <Settings size={16} /> グローバル設定
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>表示名</th>
            <th>ユーザーID</th>
            <th>状態</th>
            <th>作成日</th>
            <th>ルーム設定</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(a => (
            <tr key={a.id}>
              <td>{a.display_name}</td>
              <td>{a.login_id}</td>
              <td><span className={`badge ${a.is_active ? 'active' : 'inactive'}`}>{a.is_active ? '有効' : '無効'}</span></td>
              <td>{new Date(a.created_at).toLocaleDateString('ja-JP')}</td>
              <td>
                {(() => {
                  // ★ 2026-09-26: 文字の無いアイコンだけだと入口と分からず、ルームの無いエージェントも同じ見た目だった
                  const n = roomCounts ? (roomCounts[a.id] ?? 0) : null;
                  if (n === 0) return <span className="room-count-none">ルームなし</span>;
                  return (
                    <button className="header-btn room-count-btn" onClick={() => navigate(`/agents/${a.id}/rooms`)} title="ルーム設定を開く">
                      <MessageSquare size={14} /> {n === null ? 'ルーム' : `ルーム ${n}`}
                    </button>
                  );
                })()}
              </td>
            </tr>
          ))}
          {agents.length === 0 && <tr><td colSpan={5} className="empty">エージェントが登録されていません</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default Agents;

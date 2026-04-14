import { useState, useEffect } from 'react';
import { api } from '../services/api';

function Agents() {
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    api.getAgents().then(d => setAgents(d.agents)).catch(() => {});
  }, []);

  return (
    <div className="page">
      <h2>エージェント管理</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>表示名</th>
            <th>Employee ID</th>
            <th>状態</th>
            <th>作成日</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(a => (
            <tr key={a.id}>
              <td>{a.display_name}</td>
              <td>{a.employee_id}</td>
              <td><span className={`badge ${a.is_active ? 'active' : 'inactive'}`}>{a.is_active ? '有効' : '無効'}</span></td>
              <td>{new Date(a.created_at).toLocaleDateString('ja-JP')}</td>
            </tr>
          ))}
          {agents.length === 0 && <tr><td colSpan={4} className="empty">エージェントが登録されていません</td></tr>}
        </tbody>
      </table>
      <p className="hint">詳細設定は #104 で実装予定</p>
    </div>
  );
}

export default Agents;

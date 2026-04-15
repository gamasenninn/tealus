import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Bot, MessageSquare, Users, Webhook, Clock, BarChart3 } from 'lucide-react';

function Overview() {
  const [counts, setCounts] = useState({ agents: 0, rooms: 0, users: 0, webhooks: 0 });
  const [agentStats, setAgentStats] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getAgents().then(d => d.agents.length).catch(() => 0),
      api.getRooms().then(d => d.rooms.length).catch(() => 0),
      api.getUsers().then(d => d.users.length).catch(() => 0),
      api.getWebhooks().then(d => d.webhooks.length).catch(() => 0),
    ]).then(([agents, rooms, users, webhooks]) => {
      setCounts({ agents, rooms, users, webhooks });
    });

    api.getAgentStats().then(setAgentStats).catch(() => {});
  }, []);

  const systemCards = [
    { icon: Bot, label: 'エージェント', value: counts.agents, color: '#00B4A0' },
    { icon: MessageSquare, label: 'ルーム', value: counts.rooms, color: '#3B82F6' },
    { icon: Users, label: 'ユーザー', value: counts.users, color: '#8B5CF6' },
    { icon: Webhook, label: 'Webhook', value: counts.webhooks, color: '#F59E0B' },
  ];

  return (
    <div className="page">
      <h2>概要</h2>

      <div className="stat-cards">
        {systemCards.map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="stat-card">
            <Icon size={28} color={color} />
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>

      {agentStats && (
        <>
          <h3 style={{ marginTop: 32, marginBottom: 16 }}>エージェント統計</h3>
          <div className="stat-cards">
            <div className="stat-card">
              <MessageSquare size={28} color="#3B82F6" />
              <div className="stat-value">{agentStats.stats.today_responses}</div>
              <div className="stat-label">今日の応答</div>
            </div>
            <div className="stat-card">
              <BarChart3 size={28} color="#8B5CF6" />
              <div className="stat-value">{agentStats.stats.week_responses}</div>
              <div className="stat-label">今週の応答</div>
            </div>
            <div className="stat-card">
              <MessageSquare size={28} color="#00B4A0" />
              <div className="stat-value">{agentStats.stats.total_responses}</div>
              <div className="stat-label">全応答数</div>
            </div>
            <div className="stat-card">
              <Clock size={28} color="#F59E0B" />
              <div className="stat-value">{agentStats.stats.avg_response_time_ms ? `${(agentStats.stats.avg_response_time_ms / 1000).toFixed(1)}s` : '-'}</div>
              <div className="stat-label">平均応答時間</div>
            </div>
          </div>

          <h3 style={{ marginTop: 24, marginBottom: 12 }}>ルーム別応答回数</h3>
          <table className="data-table">
            <thead><tr><th>ルーム</th><th>応答回数</th><th>最終応答</th></tr></thead>
            <tbody>
              {agentStats.room_stats.map(r => (
                <tr key={r.room_id}>
                  <td>{r.room_name}</td>
                  <td>{r.count}</td>
                  <td>{new Date(r.last_at).toLocaleString('ja-JP')}</td>
                </tr>
              ))}
              {agentStats.room_stats.length === 0 && <tr><td colSpan={3} className="empty">データなし</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default Overview;

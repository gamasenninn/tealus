import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Bot, MessageSquare, Users, Webhook } from 'lucide-react';

function Overview() {
  const [stats, setStats] = useState({ agents: 0, rooms: 0, users: 0, webhooks: 0 });

  useEffect(() => {
    Promise.all([
      api.getAgents().then(d => d.agents.length).catch(() => 0),
      api.getRooms().then(d => d.rooms.length).catch(() => 0),
      api.getUsers().then(d => d.users.length).catch(() => 0),
      api.getWebhooks().then(d => d.webhooks.length).catch(() => 0),
    ]).then(([agents, rooms, users, webhooks]) => {
      setStats({ agents, rooms, users, webhooks });
    });
  }, []);

  const cards = [
    { icon: Bot, label: 'エージェント', value: stats.agents, color: '#00B4A0' },
    { icon: MessageSquare, label: 'ルーム', value: stats.rooms, color: '#3B82F6' },
    { icon: Users, label: 'ユーザー', value: stats.users, color: '#8B5CF6' },
    { icon: Webhook, label: 'Webhook', value: stats.webhooks, color: '#F59E0B' },
  ];

  return (
    <div className="page">
      <h2>概要</h2>
      <div className="stat-cards">
        {cards.map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="stat-card">
            <Icon size={28} color={color} />
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Overview;

import { useState, useEffect } from 'react';
import { getSocket } from '../services/socket';

function Monitor() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleAgentStatus = (data) => {
      setEvents(prev => [{
        time: new Date().toLocaleTimeString('ja-JP'),
        type: 'agent:status',
        detail: `${data.display_name}: ${data.message || data.status}`,
        room: data.room_id,
      }, ...prev].slice(0, 100));
    };

    const handleMessage = (data) => {
      setEvents(prev => [{
        time: new Date().toLocaleTimeString('ja-JP'),
        type: 'message:new',
        detail: `${data.sender_display_name}: ${(data.content || '').slice(0, 50)}`,
        room: data.room_id,
      }, ...prev].slice(0, 100));
    };

    socket.on('agent:status', handleAgentStatus);
    socket.on('message:new', handleMessage);

    return () => {
      socket.off('agent:status', handleAgentStatus);
      socket.off('message:new', handleMessage);
    };
  }, []);

  return (
    <div className="page">
      <h2>リアルタイムモニタリング</h2>
      <div className="monitor-feed">
        {events.length === 0 && <p className="empty">イベントを待機中...</p>}
        {events.map((e, i) => (
          <div key={i} className={`monitor-event ${e.type.replace(':', '-')}`}>
            <span className="monitor-time">{e.time}</span>
            <span className={`monitor-type badge ${e.type === 'agent:status' ? 'active' : 'info'}`}>{e.type}</span>
            <span className="monitor-detail">{e.detail}</span>
          </div>
        ))}
      </div>
      <p className="hint">詳細モニタリングは #106 で実装予定</p>
    </div>
  );
}

export default Monitor;

import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { Activity, MessageSquare, Clock, BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';

function Monitor() {
  const [tab, setTab] = useState('realtime');
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState({ messages: [], total: 0 });
  const [logPage, setLogPage] = useState(0);
  const [logRoomFilter, setLogRoomFilter] = useState('');
  const PAGE_SIZE = 20;

  // リアルタイムイベント
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleAgentStatus = (data) => {
      setEvents(prev => [{
        time: new Date().toLocaleTimeString('ja-JP'),
        type: 'agent:status',
        detail: `${data.display_name}: ${data.message || data.status}`,
      }, ...prev].slice(0, 100));
    };

    const handleMessage = (data) => {
      setEvents(prev => [{
        time: new Date().toLocaleTimeString('ja-JP'),
        type: 'message:new',
        detail: `${data.sender_display_name}: ${(data.content || '').slice(0, 80)}`,
      }, ...prev].slice(0, 100));
    };

    socket.on('agent:status', handleAgentStatus);
    socket.on('message:new', handleMessage);
    return () => {
      socket.off('agent:status', handleAgentStatus);
      socket.off('message:new', handleMessage);
    };
  }, []);

  // 統計データ
  useEffect(() => {
    if (tab === 'stats') {
      api.getAgentStats().then(setStats).catch(() => {});
    }
  }, [tab]);

  // 応答ログ
  useEffect(() => {
    if (tab === 'logs') {
      api.getAgentLogs(logPage * PAGE_SIZE, PAGE_SIZE, logRoomFilter || null)
        .then(setLogs).catch(() => {});
    }
  }, [tab, logPage, logRoomFilter]);

  const tabs = [
    { id: 'realtime', label: 'リアルタイム', icon: Activity },
    { id: 'stats', label: '統計', icon: BarChart3 },
    { id: 'logs', label: '応答ログ', icon: MessageSquare },
  ];

  return (
    <div className="page">
      <h2>モニタリング</h2>

      <div className="tabs">
        {tabs.map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <t.icon size={14} style={{ marginRight: 6 }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* リアルタイム */}
      {tab === 'realtime' && (
        <>
          {stats?.contexts && (
            <div className="stat-cards" style={{ marginBottom: 16 }}>
              {stats.contexts.map(c => (
                <div key={c.id} className="stat-card" style={{ padding: 16 }}>
                  <div className="setting-label">{c.room_name || c.partner_display_name || 'DM'}</div>
                  <span className={`badge ${c.status === 'processing' ? 'active' : 'info'}`}>{c.status}</span>
                </div>
              ))}
            </div>
          )}
          <div className="monitor-feed">
            {events.length === 0 && <p className="empty">イベントを待機中...</p>}
            {events.map((e, i) => (
              <div key={i} className={`monitor-event`}>
                <span className="monitor-time">{e.time}</span>
                <span className={`monitor-type badge ${e.type === 'agent:status' ? 'active' : 'info'}`}>{e.type}</span>
                <span className="monitor-detail">{e.detail}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 統計 */}
      {tab === 'stats' && stats && (
        <>
          <div className="stat-cards">
            <div className="stat-card">
              <MessageSquare size={28} color="#3B82F6" />
              <div className="stat-value">{stats.stats.today_responses}</div>
              <div className="stat-label">今日の応答</div>
            </div>
            <div className="stat-card">
              <BarChart3 size={28} color="#8B5CF6" />
              <div className="stat-value">{stats.stats.week_responses}</div>
              <div className="stat-label">今週の応答</div>
            </div>
            <div className="stat-card">
              <MessageSquare size={28} color="#00B4A0" />
              <div className="stat-value">{stats.stats.total_responses}</div>
              <div className="stat-label">全応答数</div>
            </div>
            <div className="stat-card">
              <Clock size={28} color="#F59E0B" />
              <div className="stat-value">{stats.stats.avg_response_time_ms ? `${(stats.stats.avg_response_time_ms / 1000).toFixed(1)}s` : '-'}</div>
              <div className="stat-label">平均応答時間</div>
            </div>
          </div>

          <h3 style={{ marginTop: 24, marginBottom: 12 }}>ルーム別応答回数</h3>
          <table className="data-table">
            <thead><tr><th>ルーム</th><th>応答回数</th><th>最終応答</th></tr></thead>
            <tbody>
              {stats.room_stats.map(r => (
                <tr key={r.room_id}>
                  <td>{r.room_name}</td>
                  <td>{r.count}</td>
                  <td>{new Date(r.last_at).toLocaleString('ja-JP')}</td>
                </tr>
              ))}
              {stats.room_stats.length === 0 && <tr><td colSpan={3} className="empty">データなし</td></tr>}
            </tbody>
          </table>
        </>
      )}

      {/* 応答ログ */}
      {tab === 'logs' && (
        <>
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <label className="setting-label">ルームフィルタ:</label>
            <select value={logRoomFilter} onChange={e => { setLogRoomFilter(e.target.value); setLogPage(0); }} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <option value="">全ルーム</option>
              {stats?.room_stats?.map(r => (
                <option key={r.room_id} value={r.room_id}>{r.room_name}</option>
              ))}
            </select>
            <span className="setting-desc">{logs.total} 件</span>
          </div>

          <table className="data-table">
            <thead><tr><th>日時</th><th>ルーム</th><th>内容</th><th>タイプ</th></tr></thead>
            <tbody>
              {logs.messages.map(m => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(m.created_at).toLocaleString('ja-JP')}</td>
                  <td>{m.room_name}</td>
                  <td style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content || `(${m.type})`}</td>
                  <td><span className={`badge ${m.type === 'text' ? 'info' : 'active'}`}>{m.type}</span></td>
                </tr>
              ))}
              {logs.messages.length === 0 && <tr><td colSpan={4} className="empty">ログなし</td></tr>}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 16 }}>
            <button className="icon-btn" onClick={() => setLogPage(p => Math.max(0, p - 1))} disabled={logPage === 0}>
              <ChevronLeft size={16} />
            </button>
            <span className="setting-desc">ページ {logPage + 1} / {Math.max(1, Math.ceil(logs.total / PAGE_SIZE))}</span>
            <button className="icon-btn" onClick={() => setLogPage(p => p + 1)} disabled={(logPage + 1) * PAGE_SIZE >= logs.total}>
              <ChevronRight size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Monitor;

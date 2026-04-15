import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { agentApi } from '../services/agentApi';
import { getSocket } from '../services/socket';
import { Activity, MessageSquare, ChevronLeft, ChevronRight, Terminal, RefreshCw, Search } from 'lucide-react';

function Monitor() {
  const [tab, setTab] = useState('realtime');
  const [events, setEvents] = useState([]);
  const [agentStats, setAgentStats] = useState(null);
  const [logs, setLogs] = useState({ messages: [], total: 0 });
  const [logPage, setLogPage] = useState(0);
  const [logRoomFilter, setLogRoomFilter] = useState('');
  const [serverLogs, setServerLogs] = useState({ logs: [], total: 0, date: '' });
  const [srvLogDate, setSrvLogDate] = useState('');
  const [srvLogDates, setSrvLogDates] = useState([]);
  const [srvLogLevel, setSrvLogLevel] = useState('');
  const [srvLogQuery, setSrvLogQuery] = useState('');
  const [srvLogPage, setSrvLogPage] = useState(0);
  const [srvAutoRefresh, setSrvAutoRefresh] = useState(false);
  const autoRefreshRef = useRef(null);
  const PAGE_SIZE = 20;
  const SRV_PAGE_SIZE = 100;

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

  // エージェント状態（リアルタイムタブ + 応答ログのルームフィルタ用）
  useEffect(() => {
    if (tab === 'realtime' || tab === 'logs') {
      api.getAgentStats().then(setAgentStats).catch(() => {});
    }
  }, [tab]);

  // 応答ログ
  useEffect(() => {
    if (tab === 'logs') {
      api.getAgentLogs(logPage * PAGE_SIZE, PAGE_SIZE, logRoomFilter || null)
        .then(setLogs).catch(() => {});
    }
  }, [tab, logPage, logRoomFilter]);

  // サーバーログ
  const fetchServerLogs = () => {
    agentApi.getLogs(srvLogDate || null, SRV_PAGE_SIZE, srvLogPage * SRV_PAGE_SIZE, srvLogLevel || null, srvLogQuery || null)
      .then(setServerLogs).catch(() => {});
  };

  useEffect(() => {
    if (tab === 'serverLogs') {
      agentApi.getLogDates().then(d => setSrvLogDates(d.dates)).catch(() => {});
      fetchServerLogs();
    }
  }, [tab]);

  useEffect(() => {
    if (tab === 'serverLogs') fetchServerLogs();
  }, [srvLogDate, srvLogLevel, srvLogQuery, srvLogPage]);

  // 自動更新
  useEffect(() => {
    if (srvAutoRefresh && tab === 'serverLogs') {
      autoRefreshRef.current = setInterval(fetchServerLogs, 5000);
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [srvAutoRefresh, tab, srvLogDate, srvLogLevel, srvLogQuery, srvLogPage]);

  const tabs = [
    { id: 'realtime', label: 'リアルタイム', icon: Activity },
    { id: 'logs', label: '応答ログ', icon: MessageSquare },
    { id: 'serverLogs', label: 'サーバーログ', icon: Terminal },
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
          {agentStats?.contexts && (
            <div className="stat-cards" style={{ marginBottom: 16 }}>
              {agentStats.contexts.map(c => (
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

      {/* 応答ログ */}
      {tab === 'logs' && (
        <>
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <label className="setting-label">ルームフィルタ:</label>
            <select value={logRoomFilter} onChange={e => { setLogRoomFilter(e.target.value); setLogPage(0); }} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <option value="">全ルーム</option>
              {agentStats?.room_stats?.map(r => (
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

      {/* サーバーログ */}
      {tab === 'serverLogs' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <select value={srvLogDate} onChange={e => { setSrvLogDate(e.target.value); setSrvLogPage(0); }} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <option value="">今日</option>
              {srvLogDates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            <div style={{ display: 'flex', gap: 4 }}>
              {['', 'error', 'warn', 'info', 'debug'].map(lv => (
                <button key={lv} className={`badge ${srvLogLevel === lv ? 'active' : 'info'}`}
                  style={{ cursor: 'pointer', padding: '4px 10px', border: 'none' }}
                  onClick={() => { setSrvLogLevel(lv); setSrvLogPage(0); }}>
                  {lv || 'ALL'}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Search size={14} />
              <input value={srvLogQuery} onChange={e => { setSrvLogQuery(e.target.value); setSrvLogPage(0); }}
                placeholder="キーワード検索" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, width: 200 }} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={srvAutoRefresh} onChange={e => setSrvAutoRefresh(e.target.checked)} />
              <RefreshCw size={14} /> 自動更新
            </label>

            <span className="setting-desc">{serverLogs.total} 件</span>
          </div>

          <div className="monitor-feed" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            {serverLogs.logs.length === 0 && <p className="empty">ログなし</p>}
            {serverLogs.logs.map((log, i) => (
              <div key={i} className="monitor-event">
                <span className="monitor-time">{log.timestamp}</span>
                <span className={`badge log-${log.level}`} style={{ minWidth: 50, textAlign: 'center' }}>{log.level}</span>
                <span className="monitor-detail" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{log.message}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 16 }}>
            <button className="icon-btn" onClick={() => setSrvLogPage(p => Math.max(0, p - 1))} disabled={srvLogPage === 0}>
              <ChevronLeft size={16} />
            </button>
            <span className="setting-desc">ページ {srvLogPage + 1} / {Math.max(1, Math.ceil(serverLogs.total / SRV_PAGE_SIZE))}</span>
            <button className="icon-btn" onClick={() => setSrvLogPage(p => p + 1)} disabled={(srvLogPage + 1) * SRV_PAGE_SIZE >= serverLogs.total}>
              <ChevronRight size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Monitor;

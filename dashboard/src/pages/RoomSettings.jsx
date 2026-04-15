import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { agentApi } from '../services/agentApi';
import { ArrowLeft, Save } from 'lucide-react';

function RoomSettings() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('basic');
  const [room, setRoom] = useState(null);
  const [settings, setSettings] = useState({ response_mode: 'auto', enabled: true });
  const [claudeMd, setClaudeMd] = useState('');
  const [mcpText, setMcpText] = useState('');
  const [hasMcp, setHasMcp] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // ルーム情報取得
    api.getRooms().then(d => {
      const found = d.rooms.find(r => r.id === roomId);
      setRoom(found || { id: roomId, name: roomId });
    }).catch(() => {});

    // Agent Server からルーム設定を取得
    agentApi.getRoomSettings(roomId).then(d => setSettings(d.settings)).catch(() => {});
    agentApi.getRoomClaudeMd(roomId).then(d => setClaudeMd(d.content)).catch(() => {});
    agentApi.getRoomMcp(roomId).then(d => {
      if (d.mcpConfig) {
        setMcpText(JSON.stringify(d.mcpConfig, null, 2));
        setHasMcp(true);
      }
    }).catch(() => {});
  }, [roomId]);

  const showMessage = (msg) => { setMessage(msg); setError(''); setTimeout(() => setMessage(''), 3000); };
  const showError = (msg) => { setError(msg); setMessage(''); };

  const handleSettingsSave = async () => {
    try {
      await agentApi.updateRoomSettings(roomId, settings);
      showMessage('ルーム設定を保存しました。Agent Server 再起動で反映されます。');
    } catch (e) { showError(e.message); }
  };

  const handleClaudeMdSave = async () => {
    try {
      await agentApi.updateRoomClaudeMd(roomId, claudeMd);
      showMessage('プロンプトを保存しました。');
    } catch (e) { showError(e.message); }
  };

  const handleMcpSave = async () => {
    try {
      const parsed = JSON.parse(mcpText);
      await agentApi.updateRoomMcp(roomId, parsed);
      showMessage('MCP 設定を保存しました。Agent Server 再起動で反映されます。');
    } catch (e) { showError(e.message || 'JSON の形式が正しくありません'); }
  };

  const roomName = room?.name || room?.partner_display_name || 'ルーム';
  const tabs = [
    { id: 'basic', label: '基本設定' },
    { id: 'prompt', label: 'プロンプト' },
    { id: 'mcp', label: 'MCP設定' },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="back-btn" onClick={() => navigate('/rooms')}><ArrowLeft size={18} /></button>
          <h2>{roomName} の設定</h2>
        </div>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="tabs">
        {tabs.map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'basic' && (
        <div className="settings-panel">
          <section className="settings-section">
            <h3>エージェント</h3>
            <div className="setting-row">
              <div>
                <div className="setting-label">有効/無効</div>
                <div className="setting-desc">このルームでエージェントを有効にする</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={settings.enabled ?? true} onChange={() => setSettings(prev => ({ ...prev, enabled: !prev.enabled }))} />
                <span className="toggle-slider" />
              </label>
            </div>
          </section>

          <section className="settings-section">
            <h3>応答モード</h3>
            {[
              { value: 'auto', label: '自動', desc: 'DM=全応答、グループ=メンションのみ' },
              { value: 'all', label: '全応答', desc: '全てのメッセージに応答する' },
              { value: 'mention', label: 'メンションのみ', desc: '@メンション時のみ応答する' },
              { value: 'off', label: 'OFF', desc: 'このルームでは応答しない' },
            ].map(({ value, label, desc }) => (
              <label key={value} className="radio-row">
                <input type="radio" name="response_mode" value={value} checked={settings.response_mode === value} onChange={() => setSettings(prev => ({ ...prev, response_mode: value }))} />
                <div>
                  <div className="setting-label">{label}</div>
                  <div className="setting-desc">{desc}</div>
                </div>
              </label>
            ))}
          </section>

          <button className="save-btn" onClick={handleSettingsSave}>
            <Save size={16} /> 保存
          </button>
        </div>
      )}

      {tab === 'prompt' && (
        <div className="settings-panel">
          <section className="settings-section">
            <h3>CLAUDE.md（Deep Agent プロンプト）</h3>
            <p className="setting-desc">Deep Agent がこのルームで使用するシステムプロンプト</p>
            <textarea className="setting-textarea code" value={claudeMd} onChange={e => setClaudeMd(e.target.value)} rows={20} />
          </section>
          <button className="save-btn" onClick={handleClaudeMdSave}>
            <Save size={16} /> 保存
          </button>
        </div>
      )}

      {tab === 'mcp' && (
        <div className="settings-panel">
          <section className="settings-section">
            <h3>ルーム固有 MCP 設定</h3>
            <p className="setting-desc">このルーム専用の MCP サーバー設定（JSON）。空の場合はグローバル設定のみ使用。</p>
            <textarea className="setting-textarea code" value={mcpText} onChange={e => setMcpText(e.target.value)} rows={15} placeholder='{"mcpServers": {}}' />
          </section>
          <button className="save-btn" onClick={handleMcpSave}>
            <Save size={16} /> 保存
          </button>
        </div>
      )}
    </div>
  );
}

export default RoomSettings;

import { useState, useEffect } from 'react';
import { agentApi } from '../services/agentApi';
import { Save, RotateCcw } from 'lucide-react';

function AgentSettings() {
  const [tab, setTab] = useState('basic');
  const [settings, setSettings] = useState({});
  const [mcpConfig, setMcpConfig] = useState({});
  const [mcpText, setMcpText] = useState('');
  const [env, setEnv] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    agentApi.getSettings().then(d => setSettings(d.settings)).catch(e => setError(e.message));
    agentApi.getMcpConfig().then(d => {
      setMcpConfig(d.mcpConfig);
      setMcpText(JSON.stringify(d.mcpConfig, null, 2));
    }).catch(() => {});
    agentApi.getEnv().then(d => setEnv(d.env)).catch(() => {});
  }, []);

  const showMessage = (msg) => { setMessage(msg); setError(''); setTimeout(() => setMessage(''), 3000); };
  const showError = (msg) => { setError(msg); setMessage(''); };

  const handleSettingsSave = async () => {
    try {
      await agentApi.updateSettings(settings);
      showMessage('設定を保存しました。Agent Server を再起動すると反映されます。');
    } catch (e) { showError(e.message); }
  };

  const handleMcpSave = async () => {
    try {
      const parsed = JSON.parse(mcpText);
      await agentApi.updateMcpConfig(parsed);
      setMcpConfig(parsed);
      showMessage('MCP 設定を保存しました。Agent Server を再起動すると反映されます。');
    } catch (e) { showError(e.message || 'JSON の形式が正しくありません'); }
  };

  const toggleSetting = (key) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const tabs = [
    { id: 'basic', label: '基本設定' },
    { id: 'mcp', label: 'MCP設定' },
    { id: 'env', label: '環境変数' },
  ];

  return (
    <div className="page">
      <h2>エージェント設定</h2>

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
            <h3>ツール</h3>
            {[
              { key: 'tool_tavily', label: 'Tavily 検索', desc: 'Web検索機能' },
              { key: 'tool_code_interpreter', label: 'Code Interpreter', desc: 'Python コード実行' },
              { key: 'tool_generate_image', label: '画像生成（DALL-E）', desc: 'プロンプトから画像を生成' },
              { key: 'tool_filesystem', label: 'ファイルシステム', desc: 'MCP経由でファイル操作' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="setting-row">
                <div>
                  <div className="setting-label">{label}</div>
                  <div className="setting-desc">{desc}</div>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={settings[key] ?? true} onChange={() => toggleSetting(key)} />
                  <span className="toggle-slider" />
                </label>
              </div>
            ))}
          </section>

          <section className="settings-section">
            <h3>制限値</h3>
            <div className="setting-row">
              <div>
                <div className="setting-label">Max Turns</div>
                <div className="setting-desc">1回の応答でのツール実行回数上限</div>
              </div>
              <input type="number" className="setting-number" value={settings.max_turns ?? 3} onChange={e => updateSetting('max_turns', parseInt(e.target.value) || 3)} min={1} max={20} />
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">コンテキストメッセージ数</div>
                <div className="setting-desc">会話履歴として参照するメッセージ数</div>
              </div>
              <input type="number" className="setting-number" value={settings.context_messages ?? 20} onChange={e => updateSetting('context_messages', parseInt(e.target.value) || 20)} min={1} max={100} />
            </div>
          </section>

          <section className="settings-section">
            <h3>システムプロンプト</h3>
            <p className="setting-desc">空欄の場合はデフォルトプロンプトを使用</p>
            <textarea className="setting-textarea" value={settings.system_prompt ?? ''} onChange={e => updateSetting('system_prompt', e.target.value)} rows={8} placeholder="デフォルトプロンプトを使用..." />
          </section>

          <button className="save-btn" onClick={handleSettingsSave}>
            <Save size={16} /> 保存
          </button>
        </div>
      )}

      {tab === 'mcp' && (
        <div className="settings-panel">
          <section className="settings-section">
            <h3>MCP サーバー設定</h3>
            <p className="setting-desc">mcp_config.json を直接編集できます</p>
            <textarea className="setting-textarea code" value={mcpText} onChange={e => setMcpText(e.target.value)} rows={15} />
          </section>
          <button className="save-btn" onClick={handleMcpSave}>
            <Save size={16} /> 保存
          </button>
        </div>
      )}

      {tab === 'env' && (
        <div className="settings-panel">
          <section className="settings-section">
            <h3>環境変数（閲覧のみ）</h3>
            <p className="setting-desc">変更は agent-server/.env を直接編集してください</p>
            <table className="data-table">
              <thead><tr><th>キー</th><th>値</th></tr></thead>
              <tbody>
                {Object.entries(env).map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td>{v}</td></tr>
                ))}
                {Object.keys(env).length === 0 && <tr><td colSpan={2} className="empty">環境変数が取得できません</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}

export default AgentSettings;

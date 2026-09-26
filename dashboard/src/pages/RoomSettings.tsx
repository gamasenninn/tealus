import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { agentApi } from '../services/agentApi';
import type { RoomSettingsData, TtsOptionsResponse } from '../services/agentApi';
import { ArrowLeft, Save } from 'lucide-react';

interface RoomInfo {
  id: string;
  name?: string;
  partner_display_name?: string;
}


function RoomSettings() {
  const { roomId, agentId } = useParams() as { roomId: string; agentId?: string };
  const navigate = useNavigate();
  const [tab, setTab] = useState('basic');
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [settings, setSettings] = useState<RoomSettingsData>({ response_mode: 'auto', enabled: true });
  // ★ 2026-09-26: 読み上げエンジン・声の選択肢 (一覧は agent-server の 1 か所から受け取る)
  const [ttsOptions, setTtsOptions] = useState<TtsOptionsResponse | null>(null);
  const [claudeMd, setClaudeMd] = useState('');
  const [lightPrompt, setLightPrompt] = useState('');
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
    agentApi.getTtsOptions().then(setTtsOptions).catch(() => {});
    agentApi.getRoomClaudeMd(roomId).then(d => setClaudeMd(d.content)).catch(() => {});
    agentApi.getRoomLightPrompt(roomId).then(d => setLightPrompt(d.content)).catch(() => {});
    agentApi.getRoomMcp(roomId).then(d => {
      if (d.mcpConfig) {
        setMcpText(JSON.stringify(d.mcpConfig, null, 2));
        setHasMcp(true);
      }
    }).catch(() => {});
  }, [roomId]);

  const showMessage = (msg: string) => { setMessage(msg); setError(''); setTimeout(() => setMessage(''), 3000); };
  const showError = (msg: string) => { setError(msg); setMessage(''); };

  const handleSettingsSave = async () => {
    try {
      await agentApi.updateRoomSettings(roomId, settings);
      showMessage('ルーム設定を保存しました。Agent Server 再起動で反映されます。');
    } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
  };

  const handleLightPromptSave = async () => {
    try {
      await agentApi.updateRoomLightPrompt(roomId, lightPrompt);
      showMessage('Light プロンプトを保存しました。');
    } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
  };

  const handleClaudeMdSave = async () => {
    try {
      await agentApi.updateRoomClaudeMd(roomId, claudeMd);
      showMessage('プロンプトを保存しました。');
    } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
  };

  const handleMcpSave = async () => {
    try {
      const parsed = JSON.parse(mcpText);
      await agentApi.updateRoomMcp(roomId, parsed);
      showMessage('MCP 設定を保存しました。Agent Server 再起動で反映されます。');
    } catch (e) { showError(e instanceof Error ? e.message : 'JSON の形式が正しくありません'); }
  };

  const roomName = room?.name || room?.partner_display_name || 'ルーム';
  const tabs = [
    { id: 'basic', label: '基本設定' },
    { id: 'light', label: 'Light プロンプト' },
    { id: 'deep', label: 'Deep プロンプト' },
    { id: 'mcp', label: 'MCP設定' },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="back-btn" onClick={() => navigate(agentId ? `/agents/${agentId}/rooms` : '/rooms')}><ArrowLeft size={18} /></button>
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

          <section className="settings-section">
            <h3>読み上げ</h3>
            {(() => {
              // ★ 2026-09-26: エンジン (Aivis / OpenAI / Gemini) をルームごとに選べる。声の一覧はエンジンに合わせて変わる
              const selectStyle = { padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14 };
              const opts = ttsOptions;
              const defaultLabel = opts?.engines.find(e => e.id === opts.default_engine)?.label ?? '環境変数';
              const engine = settings.tts_engine || opts?.default_engine || '';
              const voices = (opts && engine && opts.voices[engine]) || [];
              // ★ Aivis の声は tts_model_uuid、OpenAI / Gemini は tts_voice (既存の Aivis の設定をそのまま生かす)
              const voiceKey = engine === 'aivis' ? 'tts_model_uuid' : 'tts_voice';
              const voiceValue = (engine === 'aivis' ? settings.tts_model_uuid : settings.tts_voice) || '';
              const engineInfo = opts?.engines.find(e => e.id === engine);
              return (
                <>
                  {opts && !opts.room_override_effective && (
                    <div className="setting-desc" style={{ color: '#b45309', marginBottom: 8 }}>
                      全体の設定が「{opts.global_provider}」のため、ここでの選択は効きません (端末の声で読みます)
                    </div>
                  )}
                  <div className="setting-row">
                    <div>
                      <div className="setting-label">読み上げエンジン</div>
                      <div className="setting-desc">このルームの読み上げに使うエンジン</div>
                    </div>
                    <select value={settings.tts_engine || ''} disabled={!opts} style={selectStyle}
                      onChange={e => setSettings(prev => ({ ...prev, tts_engine: e.target.value || undefined }))}>
                      <option value="">デフォルト（{defaultLabel}）</option>
                      {opts?.engines.map(e => (
                        <option key={e.id} value={e.id} disabled={!e.available}>{e.label}{e.available ? '' : '（鍵が未設定）'}</option>
                      ))}
                    </select>
                  </div>
                  <div className="setting-row">
                    <div>
                      <div className="setting-label">声</div>
                      <div className="setting-desc">{engineInfo ? `${engineInfo.label} の声` : 'AIの回答を読み上げる声'}</div>
                    </div>
                    <select value={voiceValue} disabled={!opts} style={selectStyle}
                      onChange={e => setSettings(prev => ({ ...prev, [voiceKey]: e.target.value || undefined }))}>
                      <option value="">デフォルト（環境変数）</option>
                      {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                </>
              );
            })()}
          </section>

          <button className="save-btn" onClick={handleSettingsSave}>
            <Save size={16} /> 保存
          </button>
        </div>
      )}

      {tab === 'light' && (
        <div className="settings-panel">
          <section className="settings-section">
            <h3>Light Agent プロンプト</h3>
            <p className="setting-desc">Light Agent がこのルームで使用する追加指示。グローバルプロンプトに追記されます。空欄の場合はグローバルプロンプトのみ使用。</p>
            <textarea className="setting-textarea code" value={lightPrompt} onChange={e => setLightPrompt(e.target.value)} rows={12} placeholder="例: このルームでは在庫管理の専門家として振る舞ってください。" />
          </section>
          <button className="save-btn" onClick={handleLightPromptSave}>
            <Save size={16} /> 保存
          </button>
        </div>
      )}

      {tab === 'deep' && (
        <div className="settings-panel">
          <section className="settings-section">
            <h3>Deep Agent プロンプト（CLAUDE.md）</h3>
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

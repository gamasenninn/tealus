import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import './RoomSettings.css';

function RoomSettings({ roomId, currentRoom, isAdmin, isSysAdmin, selectRoom }) {
  const [transcriptionEdit, setTranscriptionEdit] = useState(currentRoom?.allow_member_transcription_edit ? 'member' : 'sender');
  const [messageEditPolicy, setMessageEditPolicy] = useState(currentRoom?.message_edit_policy || 'none');
  const [isAnnouncement, setIsAnnouncement] = useState(currentRoom?.is_announcement || false);
  const [continuousPlay, setContinuousPlay] = useState(() => localStorage.getItem('voiceContinuousPlay') === 'true');
  const [appUrls, setAppUrls] = useState(currentRoom?.app_urls || []);
  const [newAppTitle, setNewAppTitle] = useState('');
  const [newAppUrl, setNewAppUrl] = useState('');
  const [editingAppIndex, setEditingAppIndex] = useState(null);
  const [error, setError] = useState('');

  // --- エージェント設定 (#156) ---
  const canEditAgent = currentRoom?.type === 'direct' || isAdmin;
  const [responseMode, setResponseMode] = useState('auto');
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [lightPrompt, setLightPrompt] = useState('');
  const [claudeMd, setClaudeMd] = useState('');

  const showError = (msg) => setError(msg);

  useEffect(() => {
    if (!canEditAgent || !roomId) return;
    let cancelled = false;
    (async () => {
      try {
        const [s, lp, cm] = await Promise.all([
          api.getRoomAgentSettings(roomId),
          api.getRoomLightPrompt(roomId),
          api.getRoomClaudeMd(roomId),
        ]);
        if (cancelled) return;
        setResponseMode(s?.settings?.response_mode || 'auto');
        setAgentEnabled(s?.settings?.enabled !== false);
        setLightPrompt(lp?.content || '');
        setClaudeMd(cm?.content || '');
      } catch (err) {
        if (!cancelled) showError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [roomId, canEditAgent]);

  const handleResponseModeChange = async (value) => {
    const next = { response_mode: value, enabled: agentEnabled };
    setResponseMode(value);
    try {
      await api.updateRoomAgentSettings(roomId, next);
    } catch (err) { showError(err.message); }
  };

  const handleLightPromptBlur = async () => {
    try {
      await api.updateRoomLightPrompt(roomId, lightPrompt);
    } catch (err) { showError(err.message); }
  };

  const handleClaudeMdBlur = async () => {
    try {
      await api.updateRoomClaudeMd(roomId, claudeMd);
    } catch (err) { showError(err.message); }
  };

  // --- 個人設定 ---
  const handleToggleContinuousPlay = () => {
    const newValue = !continuousPlay;
    setContinuousPlay(newValue);
    localStorage.setItem('voiceContinuousPlay', String(newValue));
  };

  // --- ルーム設定（管理者） ---
  const handleTranscriptionEditChange = async (value) => {
    try {
      await api.updateRoom(roomId, { allow_member_transcription_edit: value === 'member' });
      setTranscriptionEdit(value);
      await selectRoom(roomId);
    } catch (err) { showError(err.message); }
  };

  const handleMessageEditChange = async (value) => {
    try {
      await api.updateRoom(roomId, { message_edit_policy: value });
      setMessageEditPolicy(value);
      await selectRoom(roomId);
    } catch (err) { showError(err.message); }
  };

  // --- アプリパネル ---
  const handleToggleAutoOpen = async (index) => {
    try {
      const updated = appUrls.map((app, i) => i === index ? { ...app, auto_open: !app.auto_open } : app);
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      await selectRoom(roomId);
    } catch (err) { showError(err.message); }
  };

  const handleToggleWakeLock = async (index) => {
    try {
      const updated = appUrls.map((app, i) => i === index ? { ...app, wake_lock: !app.wake_lock } : app);
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      await selectRoom(roomId);
    } catch (err) { showError(err.message); }
  };

  const handleAppRatioChange = async (index, ratio) => {
    try {
      const updated = appUrls.map((app, i) => i === index ? { ...app, ratio: parseInt(ratio) } : app);
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      await selectRoom(roomId);
    } catch (err) { showError(err.message); }
  };

  const handleAddApp = async () => {
    if (!newAppTitle.trim() || !newAppUrl.trim()) return;
    try {
      const updated = [...appUrls, { title: newAppTitle.trim(), url: newAppUrl.trim(), ratio: 50, auto_open: false, wake_lock: false }];
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      setNewAppTitle('');
      setNewAppUrl('');
      await selectRoom(roomId);
    } catch (err) { showError(err.message); }
  };

  const handleUpdateApp = async () => {
    if (editingAppIndex === null || !newAppTitle.trim() || !newAppUrl.trim()) return;
    try {
      const updated = appUrls.map((app, i) => i === editingAppIndex ? { ...app, title: newAppTitle.trim(), url: newAppUrl.trim() } : app);
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      setNewAppTitle('');
      setNewAppUrl('');
      setEditingAppIndex(null);
      await selectRoom(roomId);
    } catch (err) { showError(err.message); }
  };

  const handleEditApp = (index) => {
    setNewAppTitle(appUrls[index].title);
    setNewAppUrl(appUrls[index].url);
    setEditingAppIndex(index);
  };

  const handleRemoveApp = async (index) => {
    try {
      const updated = appUrls.filter((_, i) => i !== index);
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      await selectRoom(roomId);
    } catch (err) { showError(err.message); }
  };

  // --- システム設定 ---
  const handleToggleAnnouncement = async () => {
    try {
      const newValue = !isAnnouncement;
      await api.updateRoom(roomId, { is_announcement: newValue });
      setIsAnnouncement(newValue);
      await selectRoom(roomId);
    } catch (err) { showError(err.message); }
  };

  return (
    <>
      {error && <div className="member-error">{error}</div>}

      <div className="room-settings-section">
        <h3>個人設定</h3>
        <label className="room-setting-toggle">
          <input type="checkbox" checked={continuousPlay} onChange={handleToggleContinuousPlay} />
          <span>音声の連続再生</span>
        </label>
      </div>

      {isAdmin && (
        <div className="room-settings-section">
          <h3>ルーム設定（管理者）</h3>
          <div className="room-setting-select">
            <label>文字起こし編集</label>
            <select value={transcriptionEdit} onChange={e => handleTranscriptionEditChange(e.target.value)}>
              <option value="sender">送信者のみ</option>
              <option value="member">メンバー全員</option>
            </select>
          </div>
          <div className="room-setting-select">
            <label>メッセージ編集</label>
            <select value={messageEditPolicy} onChange={e => handleMessageEditChange(e.target.value)}>
              <option value="none">無効</option>
              <option value="sender">送信者のみ</option>
              <option value="member">メンバー全員</option>
            </select>
          </div>

          <h4 className="room-settings-sub">アプリパネル</h4>
          {appUrls.map((app, i) => (
            <div key={i} className="app-url-item">
              <div className="app-url-info">
                <span className="app-url-title">{app.title}</span>
                <span className="app-url-url">{app.url}</span>
                <div className="app-url-ratio">
                  <label>分割: {app.ratio || 50}%</label>
                  <input type="range" min="20" max="80" value={app.ratio || 50} onChange={e => handleAppRatioChange(i, e.target.value)} />
                </div>
                <label className="app-url-auto-open">
                  <input type="checkbox" checked={app.auto_open || false} onChange={() => handleToggleAutoOpen(i)} />
                  <span>自動で開く</span>
                </label>
                <label className="app-url-auto-open">
                  <input type="checkbox" checked={app.wake_lock || false} onChange={() => handleToggleWakeLock(i)} />
                  <span>画面をONに保つ</span>
                </label>
              </div>
              <div className="app-url-actions">
                <button className="app-url-edit" onClick={() => handleEditApp(i)}>編集</button>
                <button className="app-url-remove" onClick={() => handleRemoveApp(i)}>✕</button>
              </div>
            </div>
          ))}
          <div className="app-url-add">
            <input type="text" placeholder="タイトル" value={newAppTitle} onChange={e => setNewAppTitle(e.target.value)} />
            <input type="url" placeholder="URL" value={newAppUrl} onChange={e => setNewAppUrl(e.target.value)} />
            {editingAppIndex !== null ? (
              <>
                <button className="app-url-add-btn" onClick={handleUpdateApp} disabled={!newAppTitle.trim() || !newAppUrl.trim()}>更新</button>
                <button className="app-url-cancel-btn" onClick={() => { setEditingAppIndex(null); setNewAppTitle(''); setNewAppUrl(''); }}>取消</button>
              </>
            ) : (
              <button className="app-url-add-btn" onClick={handleAddApp} disabled={!newAppTitle.trim() || !newAppUrl.trim()}>追加</button>
            )}
          </div>
        </div>
      )}

      {isSysAdmin && (
        <div className="room-settings-section">
          <h3>システム設定</h3>
          <label className="room-setting-toggle">
            <input type="checkbox" checked={isAnnouncement} onChange={handleToggleAnnouncement} />
            <span>ホーム画面にお知らせとして表示</span>
          </label>
        </div>
      )}

      {canEditAgent && (
        <div className="room-settings-section">
          <h3>エージェント設定</h3>
          <div className="room-setting-select">
            <label htmlFor="agent-response-mode">応答モード</label>
            <select
              id="agent-response-mode"
              value={responseMode}
              onChange={e => handleResponseModeChange(e.target.value)}
            >
              <option value="auto">自動</option>
              <option value="all">全メッセージ</option>
              <option value="mention">メンション時のみ</option>
              <option value="off">停止</option>
            </select>
          </div>
          <div className="room-setting-textarea">
            <label htmlFor="agent-light-prompt">Light Agent プロンプト</label>
            <textarea
              id="agent-light-prompt"
              value={lightPrompt}
              onChange={e => setLightPrompt(e.target.value)}
              onBlur={handleLightPromptBlur}
              rows={6}
              placeholder="このルームでの Light Agent の振る舞いを記述 (空欄でデフォルト)"
            />
          </div>
          <div className="room-setting-textarea">
            <label htmlFor="agent-deep-prompt">Deep Agent プロンプト</label>
            <textarea
              id="agent-deep-prompt"
              value={claudeMd}
              onChange={e => setClaudeMd(e.target.value)}
              onBlur={handleClaudeMdBlur}
              rows={6}
              placeholder="このルームでの Deep Agent の振る舞いを記述 (空欄でデフォルト)"
            />
          </div>
        </div>
      )}
    </>
  );
}

export default RoomSettings;

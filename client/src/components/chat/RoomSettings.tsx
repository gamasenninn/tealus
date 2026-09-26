import { useState, useEffect } from 'react';
import { api, type TtsOptions } from '../../services/api';
import type { AppUrl, Room } from '../../types';
import './RoomSettings.css';


/** agent-server /config/room/:roomId/settings 応答の settings 部 */
interface AgentSettings {
  response_mode?: string;
  enabled?: boolean;
  tts_model_uuid?: string;
  /** ★ 2026-09-26: 読み上げエンジン (未設定 = 全体の設定) / OpenAI・Gemini の声 */
  tts_engine?: string;
  tts_voice?: string;
  /** ★ ほかの項目 (ダッシュボードで足されたもの等) も保存時に残す */
  [key: string]: unknown;
}

interface RoomSettingsProps {
  roomId: string;
  currentRoom: Room | null;
  isAdmin: boolean;
  isSysAdmin: boolean;
  selectRoom: (roomId: string) => Promise<void>;
}

function RoomSettings({ roomId, currentRoom, isAdmin, isSysAdmin, selectRoom }: RoomSettingsProps) {
  const [transcriptionEdit, setTranscriptionEdit] = useState<string>(currentRoom?.allow_member_transcription_edit ? 'member' : 'sender');
  const [messageEditPolicy, setMessageEditPolicy] = useState<string>(currentRoom?.message_edit_policy || 'none');
  // #405 Realtime 音声会話 (docs/08 §12)。★ 既定 false = 明示的に開けたルームだけ
  const [voiceConversation, setVoiceConversation] = useState<boolean>(!!currentRoom?.voice_conversation_enabled);
  // ★ #418 会話モードの道具。既定は全許可で、ここでは**外す**方を選ぶ (docs/08 §12.17)
  const [toolCatalog, setToolCatalog] = useState<{ tools: Array<{ name: string; description: string }>; default_denied: string[]; protected: string[] } | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolsReload, setToolsReload] = useState(0);
  // ★ 外す道具 / 既定で外れているものを戻す道具。どちらも DB の列から来る
  const [deniedTools, setDeniedTools] = useState<string[]>(currentRoom?.voice_conversation_denied_tools || []);
  const [restoredTools, setRestoredTools] = useState<string[]>(currentRoom?.voice_conversation_tools || []);
  const [isAnnouncement, setIsAnnouncement] = useState(currentRoom?.is_announcement || false);
  const [continuousPlay, setContinuousPlay] = useState(() => localStorage.getItem('voiceContinuousPlay') === 'true');
  const [appUrls, setAppUrls] = useState<AppUrl[]>(currentRoom?.app_urls || []);
  const [newAppTitle, setNewAppTitle] = useState('');
  const [newAppUrl, setNewAppUrl] = useState('');
  const [editingAppIndex, setEditingAppIndex] = useState<number | null>(null);
  const [error, setError] = useState('');

  // --- エージェント設定 (#156) ---
  const canEditAgent = currentRoom?.type === 'direct' || isAdmin;
  // ★ 2026-09-26: 読み込んだ設定を丸ごと持つ。保存は「変えた項目だけ差し替え」
  //   (以前は 3 項目だけで上書きしていて、ダッシュボードで決めた tts_engine / tts_voice が消えた)
  const [agentSettings, setAgentSettings] = useState<AgentSettings>({ response_mode: 'auto', enabled: true });
  const [ttsOptions, setTtsOptions] = useState<TtsOptions | null>(null);
  const responseMode = agentSettings.response_mode || 'auto';
  const [lightPrompt, setLightPrompt] = useState('');
  const [claudeMd, setClaudeMd] = useState('');

  const showError = (msg: string) => setError(msg);

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
        const settings = (s as { settings?: AgentSettings } | null)?.settings;
        setAgentSettings({ response_mode: 'auto', enabled: true, ...(settings || {}) });
        setLightPrompt(lp?.content || '');
        setClaudeMd(cm?.content || '');
      } catch (err) {
        if (!cancelled) showError(err instanceof Error ? err.message : String(err));
      }
    })();
    // ★ 選択肢は別に取る (失敗しても他の設定は使える)
    api.getTtsOptions().then(o => { if (!cancelled) setTtsOptions(o); }).catch(() => {});
    return () => { cancelled = true; };
  }, [roomId, canEditAgent]);

  /** ★ 変えた項目だけ差し替えて保存する。undefined にした項目は消す (= 全体の設定に戻す) */
  const saveAgentSettings = async (patch: Partial<AgentSettings>) => {
    const next: AgentSettings = { ...agentSettings, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    setAgentSettings(next);
    try {
      await api.updateRoomAgentSettings(roomId, next);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  const handleResponseModeChange = (value: string) => saveAgentSettings({ response_mode: value });

  const handleLightPromptBlur = async () => {
    try {
      await api.updateRoomLightPrompt(roomId, lightPrompt);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  const handleClaudeMdBlur = async () => {
    try {
      await api.updateRoomClaudeMd(roomId, claudeMd);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  // --- 個人設定 ---
  const handleToggleContinuousPlay = () => {
    const newValue = !continuousPlay;
    setContinuousPlay(newValue);
    localStorage.setItem('voiceContinuousPlay', String(newValue));
  };

  // --- ルーム設定（管理者） ---
  const handleTranscriptionEditChange = async (value: string) => {
    try {
      await api.updateRoom(roomId, { allow_member_transcription_edit: value === 'member' });
      setTranscriptionEdit(value);
      await selectRoom(roomId);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  /**
   * #405 会話モードの可否 (docs/08 §4.1)。★ 全ルーム解放にしない根拠は §4 の理由② ——
   * 会話モードは未知の失敗をするので、壊れたときにその 1 ルームで止まる方がよい。
   */
  /**
   * ★ #418 そのルームで使える道具の一覧を取りに行く (docs/08 §12.17)。
   *
   * ★★ MCP を起こすので数秒〜数十秒かかる。**開いているルームでだけ**呼ぶ
   *   (開いていないルームのために MCP を温めない)。
   * ★ 副次効果として、設定画面を開くと次の会話の接続が速くなる。
   */
  useEffect(() => {
    if (!isAdmin || !roomId || !voiceConversation) return;
    let cancelled = false;
    setToolsLoading(true);
    setToolsError(null);
    (async () => {
      try {
        const c = await api.getVoiceChatTools(roomId);
        if (!cancelled) setToolCatalog(c);
      } catch (err) {
        if (!cancelled) setToolsError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setToolsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [roomId, isAdmin, voiceConversation, toolsReload]);

  /**
   * ★ チェックを切り替える。**checked = 許可**。
   *   既定で外れているもの (消す系) は「戻す」側の配列へ、それ以外は「外す」側の配列へ入れる。
   */
  const handleToolToggle = async (name: string, nowAllowed: boolean) => {
    const isDefaultDenied = (toolCatalog?.default_denied || []).includes(name);
    const nextDenied = isDefaultDenied
      ? deniedTools
      : nowAllowed ? deniedTools.filter((t) => t !== name) : [...deniedTools, name];
    const nextRestored = isDefaultDenied
      ? nowAllowed ? [...restoredTools, name] : restoredTools.filter((t) => t !== name)
      : restoredTools;

    setDeniedTools(nextDenied);
    setRestoredTools(nextRestored);
    try {
      await api.updateRoom(roomId, {
        voice_conversation_denied_tools: nextDenied,
        voice_conversation_tools: nextRestored,
      });
      await selectRoom(roomId);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  const handleVoiceConversationChange = async (value: string) => {
    const enabled = value === 'on';
    try {
      await api.updateRoom(roomId, { voice_conversation_enabled: enabled });
      setVoiceConversation(enabled);
      await selectRoom(roomId);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  /**
   * ★ このルームの MCP の道具を、名指しで会話モードに出す (#405)。
   * ★★ ここに置くのは requireRoomAdmin で守られているから。room_settings.json 側は
   *   認証のみで誰でも書けるので、`execute_sql` の許可を置くと危ない。
   * ★ 道具の名前は agent-server のログに出る (会話を開くと「未許可: ...」で列挙される)。
   */

  const handleMessageEditChange = async (value: string) => {
    try {
      await api.updateRoom(roomId, { message_edit_policy: value as Room['message_edit_policy'] });
      setMessageEditPolicy(value);
      await selectRoom(roomId);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  // --- アプリパネル ---
  const handleToggleAutoOpen = async (index: number) => {
    try {
      const updated = appUrls.map((app, i) => i === index ? { ...app, auto_open: !app.auto_open } : app);
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      await selectRoom(roomId);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  const handleToggleWakeLock = async (index: number) => {
    try {
      const updated = appUrls.map((app, i) => i === index ? { ...app, wake_lock: !app.wake_lock } : app);
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      await selectRoom(roomId);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  const handleAppRatioChange = async (index: number, ratio: string) => {
    try {
      const updated = appUrls.map((app, i) => i === index ? { ...app, ratio: parseInt(ratio) } : app);
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      await selectRoom(roomId);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
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
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
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
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  const handleEditApp = (index: number) => {
    setNewAppTitle(appUrls[index].title || '');
    setNewAppUrl(appUrls[index].url);
    setEditingAppIndex(index);
  };

  const handleRemoveApp = async (index: number) => {
    try {
      const updated = appUrls.filter((_, i) => i !== index);
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      await selectRoom(roomId);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
  };

  // --- システム設定 ---
  const handleToggleAnnouncement = async () => {
    try {
      const newValue = !isAnnouncement;
      await api.updateRoom(roomId, { is_announcement: newValue });
      setIsAnnouncement(newValue);
      await selectRoom(roomId);
    } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
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
            <label>AI と音声で話す</label>
            <select value={voiceConversation ? 'on' : 'off'} onChange={e => handleVoiceConversationChange(e.target.value)}>
              <option value="off">開かない</option>
              <option value="on">このルームで開く</option>
            </select>
          </div>
          {voiceConversation && (
            <div className="voice-tools">
              <label className="voice-tools-label">会話で使える道具</label>
              {/*
                ★ #418 既定は全許可。ここでは**外す**方を選ぶ (docs/08 §12.17)。
                ★★ 消す系 5 つは既定で外れており、戻すとそのルームの設定ファイルまで
                   書き換えられるようになるので、警告をここに置く。
              */}
              {toolsLoading && (
                <p className="voice-tools-note">道具の一覧を取得しています…（初回は数十秒かかることがあります）</p>
              )}
              {toolsError && (
                <p className="voice-tools-error">
                  一覧を取得できませんでした: {toolsError}
                  <button type="button" onClick={() => setToolsReload((n) => n + 1)}>やり直す</button>
                </p>
              )}
              {toolCatalog && !toolsLoading && (
                <>
                  <p className="voice-tools-note">
                    チェックを外すと、このルームの会話では使えなくなります。
                    ★ 消す系は既定で外れています（戻すと<strong>このルームの設定ファイルも書き換えられます</strong>）。
                  </p>
                  {toolCatalog.tools.map((t) => {
                    const isProtected = toolCatalog.protected.includes(t.name);
                    const isDefaultDenied = toolCatalog.default_denied.includes(t.name);
                    const checked = isProtected
                      ? true
                      : isDefaultDenied
                        ? restoredTools.includes(t.name)
                        : !deniedTools.includes(t.name);
                    return (
                      <label key={t.name} className="voice-tool-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isProtected}
                          aria-label={`${t.name} — ${t.description}`}
                          onChange={() => handleToolToggle(t.name, !checked)}
                        />
                        <span className="voice-tool-name">{t.name}</span>
                        <span className="voice-tool-desc">
                          {t.description}
                          {isProtected && '（昇格に必要なので外せません）'}
                          {isDefaultDenied && '（既定で外れています）'}
                        </span>
                      </label>
                    );
                  })}
                </>
              )}
            </div>
          )}
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
          {(() => {
            // ★ 2026-09-26: 読み上げエンジン (Aivis / OpenAI / Gemini) と声。ダッシュボードと同じ決め方
            const opts = ttsOptions;
            const defaultLabel = opts?.engines.find(e => e.id === opts.default_engine)?.label ?? '環境変数';
            const engine = agentSettings.tts_engine || opts?.default_engine || '';
            const voices = (opts && engine && opts.voices[engine]) || [];
            // ★ Aivis の声は tts_model_uuid、OpenAI / Gemini は tts_voice (既存の Aivis の設定を生かす)
            const voiceKey = engine === 'aivis' ? 'tts_model_uuid' : 'tts_voice';
            const voiceValue = String((engine === 'aivis' ? agentSettings.tts_model_uuid : agentSettings.tts_voice) || '');
            return (
              <>
                {opts && !opts.room_override_effective && (
                  <p className="room-setting-note">全体の設定が「{opts.global_provider}」のため、ここでの選択は効きません (端末の声で読みます)</p>
                )}
                <div className="room-setting-select">
                  <label htmlFor="agent-tts-engine">読み上げエンジン</label>
                  <select
                    id="agent-tts-engine"
                    value={agentSettings.tts_engine || ''}
                    disabled={!opts}
                    onChange={e => saveAgentSettings({ tts_engine: e.target.value || undefined })}
                  >
                    <option value="">デフォルト（{defaultLabel}）</option>
                    {opts?.engines.map(e => (
                      <option key={e.id} value={e.id} disabled={!e.available}>{e.label}{e.available ? '' : '（鍵が未設定）'}</option>
                    ))}
                  </select>
                </div>
                <div className="room-setting-select">
                  <label htmlFor="agent-tts-voice">声</label>
                  <select
                    id="agent-tts-voice"
                    value={voiceValue}
                    disabled={!opts}
                    onChange={e => saveAgentSettings({ [voiceKey]: e.target.value || undefined })}
                  >
                    <option value="">デフォルト（環境変数）</option>
                    {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              </>
            );
          })()}
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

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useRoomStore } from '../../stores/roomStore';
import { api } from '../../services/api';
import { Pencil } from 'lucide-react';
import './MemberList.css';

function MemberList({ roomId, onClose }) {
  const { user } = useAuthStore();
  const { currentRoom, members, selectRoom } = useRoomStore();
  const navigate = useNavigate();
  const [allUsers, setAllUsers] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [menuTarget, setMenuTarget] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [groupName, setGroupName] = useState(currentRoom?.name || '');
  const iconInputRef = useRef(null);
  const [error, setError] = useState('');
  const [transcriptionEdit, setTranscriptionEdit] = useState(currentRoom?.allow_member_transcription_edit || false);
  const [isAnnouncement, setIsAnnouncement] = useState(currentRoom?.is_announcement || false);
  const [continuousPlay, setContinuousPlay] = useState(() => localStorage.getItem('voiceContinuousPlay') === 'true');
  const [appUrls, setAppUrls] = useState(currentRoom?.app_urls || []);
  const [newAppTitle, setNewAppTitle] = useState('');
  const [newAppUrl, setNewAppUrl] = useState('');
  const [editingAppIndex, setEditingAppIndex] = useState(null);

  const myRole = members.find(m => m.user_id === user.id)?.role;
  const isAdmin = myRole === 'admin';

  const handleToggleContinuousPlay = () => {
    const newValue = !continuousPlay;
    setContinuousPlay(newValue);
    localStorage.setItem('voiceContinuousPlay', String(newValue));
  };

  const isSysAdmin = user?.role === 'admin';

  const handleToggleAnnouncement = async () => {
    try {
      const newValue = !isAnnouncement;
      await api.updateRoom(roomId, { is_announcement: newValue });
      setIsAnnouncement(newValue);
      await selectRoom(roomId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddApp = async () => {
    if (!newAppTitle.trim() || !newAppUrl.trim()) return;
    try {
      const updated = [...appUrls, { title: newAppTitle.trim(), url: newAppUrl.trim(), ratio: 50 }];
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      setNewAppTitle('');
      setNewAppUrl('');
      await selectRoom(roomId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdateApp = async () => {
    if (editingAppIndex === null || !newAppTitle.trim() || !newAppUrl.trim()) return;
    try {
      const updated = appUrls.map((app, i) =>
        i === editingAppIndex ? { ...app, title: newAppTitle.trim(), url: newAppUrl.trim() } : app
      );
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      setNewAppTitle('');
      setNewAppUrl('');
      setEditingAppIndex(null);
      await selectRoom(roomId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEditApp = (index) => {
    setNewAppTitle(appUrls[index].title);
    setNewAppUrl(appUrls[index].url);
    setEditingAppIndex(index);
  };

  const handleAppRatioChange = async (index, ratio) => {
    try {
      const updated = appUrls.map((app, i) =>
        i === index ? { ...app, ratio: parseInt(ratio) } : app
      );
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      await selectRoom(roomId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveApp = async (index) => {
    try {
      const updated = appUrls.filter((_, i) => i !== index);
      await api.updateRoom(roomId, { app_urls: updated });
      setAppUrls(updated);
      await selectRoom(roomId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleTranscriptionEdit = async () => {
    try {
      const newValue = !transcriptionEdit;
      await api.updateRoom(roomId, { allow_member_transcription_edit: newValue });
      setTranscriptionEdit(newValue);
      await selectRoom(roomId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveName = async () => {
    if (!groupName.trim()) return;
    try {
      await api.updateRoom(roomId, { name: groupName.trim() });
      await selectRoom(roomId);
      setEditingName(false);
    } catch (err) {
      showError(err.message);
    }
  };

  const handleIconChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await api.uploadRoomIcon(roomId, file);
      await selectRoom(roomId);
    } catch (err) {
      showError(err.message);
    }
    e.target.value = '';
  };

  const showError = (msg) => {
    setError(msg);
    setTimeout(() => setError(''), 5000);
  };

  const handleAddMembers = async () => {
    try {
      for (const userId of selectedUsers) {
        await api.addMember(roomId, userId);
      }
      setShowAddModal(false);
      setSelectedUsers([]);
      await selectRoom(roomId);
    } catch (err) {
      showError(err.message);
    }
  };

  const handleLeave = async () => {
    if (!confirm('このグループを退会しますか？\n退会するとこのグループのメッセージは閲覧できなくなります。')) return;
    try {
      await api.leaveRoom(roomId);
      navigate('/talk');
    } catch (err) {
      showError(err.message);
    }
  };

  const handleKick = async (targetId, targetName) => {
    if (!confirm(`${targetName}をグループから除外しますか？`)) return;
    try {
      await api.kickMember(roomId, targetId);
      setMenuTarget(null);
      await selectRoom(roomId);
    } catch (err) {
      showError(err.message);
    }
  };

  const handleRoleChange = async (targetId, newRole) => {
    try {
      await api.changeMemberRole(roomId, targetId, newRole);
      setMenuTarget(null);
      await selectRoom(roomId);
    } catch (err) {
      showError(err.message);
    }
  };

  const openAddModal = async () => {
    try {
      const data = await api.getUsers();
      const memberIds = members.map(m => m.user_id);
      setAllUsers(data.users.filter(u => !memberIds.includes(u.id)));
      setSelectedUsers([]);
      setShowAddModal(true);
    } catch (err) {
      showError(err.message);
    }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  return (
    <div className="member-list-overlay" onClick={onClose}>
      <div className="member-list-modal" onClick={e => { e.stopPropagation(); if (menuTarget) setMenuTarget(null); }}>
        <div className="group-settings">
          <div className="group-icon-area" onClick={() => isAdmin && iconInputRef.current?.click()}>
            {currentRoom?.icon_url ? (
              <img src={`/media/${currentRoom.icon_url}`} alt="" className="group-icon-img" />
            ) : (
              <span className="group-icon-placeholder">👥</span>
            )}
            {isAdmin && <div className="group-icon-overlay">変更</div>}
            <input ref={iconInputRef} type="file" accept="image/*" onChange={handleIconChange} hidden />
          </div>
          <div className="group-name-area">
            {editingName ? (
              <div className="group-name-edit">
                <input value={groupName} onChange={e => setGroupName(e.target.value)} autoFocus />
                <button className="group-name-save" onClick={handleSaveName}>✓</button>
                <button className="group-name-cancel" onClick={() => { setEditingName(false); setGroupName(currentRoom?.name || ''); }}>✕</button>
              </div>
            ) : (
              <div className="group-name-display">
                <span>{currentRoom?.name}</span>
                {isAdmin && <button className="group-name-edit-btn" onClick={() => setEditingName(true)}><Pencil size={14} /></button>}
              </div>
            )}
          </div>
        </div>

        <h3>メンバー一覧</h3>

        {error && <div className="member-error">{error}</div>}

        <div className="member-items">
          {members.map(m => (
            <div key={m.user_id} className="member-item">
              <div className="member-info">
                {m.role === 'admin' && <span className="member-crown">👑</span>}
                <span className="member-name">{m.display_name}</span>
                {m.role === 'admin' && <span className="member-role-label">グループ管理者</span>}
              </div>
              {isAdmin && m.user_id !== user.id && (
                <button className="member-menu-btn" onClick={() => setMenuTarget(menuTarget === m.user_id ? null : m.user_id)}>
                  ...
                </button>
              )}
              {menuTarget === m.user_id && (
                <div className="member-menu">
                  {m.role === 'member' ? (
                    <button onClick={() => handleRoleChange(m.user_id, 'admin')}>グループ管理者にする</button>
                  ) : (
                    <button onClick={() => handleRoleChange(m.user_id, 'member')}>グループ管理者を解除</button>
                  )}
                  <button className="member-menu-danger" onClick={() => handleKick(m.user_id, m.display_name)}>除外する</button>
                </div>
              )}
            </div>
          ))}
        </div>

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
            <label className="room-setting-toggle">
              <input type="checkbox" checked={transcriptionEdit} onChange={handleToggleTranscriptionEdit} />
              <span>メンバーの文字起こし編集を許可</span>
            </label>

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

        <div className="member-actions">
          <button className="member-add-btn" onClick={openAddModal}>+ メンバーを追加</button>
          <button className="member-leave-btn" onClick={handleLeave}>このグループを退会</button>
        </div>

        <button className="member-close-btn" onClick={onClose}>閉じる</button>
      </div>

      {showAddModal && (
        <div className="member-add-overlay" onClick={() => setShowAddModal(false)}>
          <div className="member-add-modal" onClick={e => e.stopPropagation()}>
            <h3>メンバーを追加</h3>
            <div className="member-add-list">
              {allUsers.length === 0 && <p className="member-add-empty">追加できるユーザーがいません</p>}
              {allUsers.map(u => (
                <label key={u.id} className="member-add-item">
                  <input
                    type="checkbox"
                    checked={selectedUsers.includes(u.id)}
                    onChange={() => toggleUserSelection(u.id)}
                  />
                  <span>{u.display_name}（{u.employee_id}）</span>
                </label>
              ))}
            </div>
            <div className="member-add-buttons">
              <button className="member-add-cancel" onClick={() => setShowAddModal(false)}>キャンセル</button>
              <button className="member-add-submit" onClick={handleAddMembers} disabled={selectedUsers.length === 0}>
                追加（{selectedUsers.length}人）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MemberList;

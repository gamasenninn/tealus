import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useRoomStore } from '../../stores/roomStore';
import { api } from '../../services/api';
import { Pencil } from 'lucide-react';
import RoomSettings from './RoomSettings';
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

  const myRole = members.find(m => m.user_id === user.id)?.role;
  const isAdmin = myRole === 'admin';
  const isSysAdmin = user?.role === 'admin';

  const handleSaveName = async () => {
    if (!groupName.trim()) return;
    try {
      await api.updateRoom(roomId, { name: groupName.trim() });
      await selectRoom(roomId);
      setEditingName(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleIconChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await api.uploadRoomIcon(roomId, file);
      await selectRoom(roomId);
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
    }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleAddMembers = async () => {
    try {
      for (const userId of selectedUsers) {
        await api.addMember(roomId, userId);
      }
      await selectRoom(roomId);
      setShowAddModal(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLeave = async () => {
    if (!confirm('このグループを退会しますか？\n退会するとこのグループのメッセージは閲覧できなくなります。')) return;
    try {
      await api.leaveRoom(roomId);
      navigate('/talk');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleKick = async (userId, displayName) => {
    if (!confirm(`${displayName}をこのグループから除外しますか？`)) return;
    try {
      await api.kickMember(roomId, userId);
      await selectRoom(roomId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await api.changeMemberRole(roomId, userId, newRole);
      await selectRoom(roomId);
    } catch (err) {
      setError(err.message);
    }
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

        <RoomSettings
          roomId={roomId}
          currentRoom={currentRoom}
          isAdmin={isAdmin}
          isSysAdmin={isSysAdmin}
          selectRoom={selectRoom}
        />

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

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoomStore } from '../../stores/roomStore';
import { api } from '../../services/api';
import './CreateRoom.css';

function CreateRoom({ onClose }) {
  const [mode, setMode] = useState('select'); // select, direct, group
  const [users, setUsers] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [error, setError] = useState('');
  const { createGroup, createDirect } = useRoomStore();
  const navigate = useNavigate();

  useEffect(() => {
    api.getUsers().then((data) => setUsers(data.users || [])).catch(() => {});
  }, []);

  const handleCreateDirect = async (userId) => {
    try {
      const data = await createDirect(userId);
      onClose();
      navigate(`/rooms/${data.room.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setError('グループ名を入力してください');
      return;
    }
    try {
      const data = await createGroup(groupName, selectedUsers);
      onClose();
      navigate(`/rooms/${data.room.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleUser = (userId) => {
    setSelectedUsers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  return (
    <div className="create-room-overlay" onClick={onClose}>
      <div className="create-room-modal" onClick={(e) => e.stopPropagation()}>
        {mode === 'select' && (
          <>
            <h2>新しいトーク</h2>
            <div className="create-room-options">
              <button onClick={() => setMode('direct')}>1対1トーク</button>
              <button onClick={() => setMode('group')}>グループ作成</button>
            </div>
            <button className="create-room-cancel" onClick={onClose}>キャンセル</button>
          </>
        )}

        {mode === 'direct' && (
          <>
            <h2>相手を選択</h2>
            {error && <div className="create-room-error">{error}</div>}
            <div className="create-room-user-list">
              {users.map((u) => (
                <div key={u.id} className="create-room-user" onClick={() => handleCreateDirect(u.id)}>
                  <span>{u.display_name}</span>
                  <span className="create-room-emp-id">{u.login_id}</span>
                </div>
              ))}
            </div>
            <button className="create-room-cancel" onClick={() => setMode('select')}>戻る</button>
          </>
        )}

        {mode === 'group' && (
          <>
            <h2>グループ作成</h2>
            {error && <div className="create-room-error">{error}</div>}
            <input
              type="text"
              placeholder="グループ名"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="create-room-input"
            />
            <div className="create-room-user-list">
              {users.map((u) => (
                <div
                  key={u.id}
                  className={`create-room-user ${selectedUsers.includes(u.id) ? 'selected' : ''}`}
                  onClick={() => toggleUser(u.id)}
                >
                  <span>{u.display_name}</span>
                  {selectedUsers.includes(u.id) && <span className="check-mark">✓</span>}
                </div>
              ))}
            </div>
            <button className="create-room-submit" onClick={handleCreateGroup}>作成</button>
            <button className="create-room-cancel" onClick={() => setMode('select')}>戻る</button>
          </>
        )}
      </div>
    </div>
  );
}

export default CreateRoom;

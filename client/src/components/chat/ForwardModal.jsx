import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Search } from 'lucide-react';
import { api } from '../../services/api';
import { useRoomStore } from '../../stores/roomStore';
import './ForwardModal.css';

/**
 * #166 メッセージ転送モーダル
 * 現在のルームを除外し、他ルームを検索・選択して転送する（MVP: テキスト・単一ルーム・コメント無し）
 */
function ForwardModal({ message, onClose }) {
  const navigate = useNavigate();
  const { rooms, fetchRooms } = useRoomStore();
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (rooms.length === 0) fetchRooms();
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const filteredRooms = rooms
    .filter(r => r.id !== message.room_id) // 現在のルームを除外
    .filter(r => {
      if (!search.trim()) return true;
      const name = (r.name || r.partner_display_name || '').toLowerCase();
      return name.includes(search.toLowerCase());
    });

  const handleSelect = async (targetRoom) => {
    if (sending) return;
    const targetName = targetRoom.name || targetRoom.partner_display_name || 'DM';
    if (!confirm(`「${targetName}」にメッセージを転送しますか？`)) return;

    setSending(true);
    setError('');
    try {
      await api.sendMessage(
        targetRoom.id,
        message.content,
        null, // reply_to
        message.id, // forwarded_from
      );
      onClose();
      navigate(`/talk/${targetRoom.id}`);
    } catch (err) {
      setError('転送に失敗しました: ' + (err.message || ''));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay z-high" onClick={onClose}>
      <div className="modal-box forward-modal" onClick={e => e.stopPropagation()}>
        <h3>
          <Share2 size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          転送先を選択
        </h3>

        <div className="forward-search-row">
          <Search size={16} className="forward-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="forward-search-input"
            placeholder="ルーム名で検索..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {error && <div className="forward-error">{error}</div>}

        <div className="forward-room-list">
          {filteredRooms.length === 0 ? (
            <div className="forward-empty">転送先のルームがありません</div>
          ) : (
            filteredRooms.map(r => {
              const name = r.name || r.partner_display_name || 'DM';
              return (
                <button
                  key={r.id}
                  className="forward-room-item"
                  onClick={() => handleSelect(r)}
                  disabled={sending}
                >
                  <span className="forward-room-name">{name}</span>
                  <span className={`forward-room-type badge ${r.type}`}>{r.type === 'direct' ? 'DM' : 'グループ'}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="forward-actions">
          <button className="forward-cancel-btn" onClick={onClose} disabled={sending}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

export default ForwardModal;

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';
import StampGenerator from './StampGenerator';
import { LONG_PRESS_TIMEOUT } from '../../constants/ui';
import { Pencil, Trash2 } from 'lucide-react';
import './StampPicker.css';

function StampPicker({ onSelect, onClose }) {
  const { user } = useAuthStore();
  const [packs, setPacks] = useState([]);
  const [selectedPack, setSelectedPack] = useState(null);
  const [stamps, setStamps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerator, setShowGenerator] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const longPressTimer = useRef(null);

  useEffect(() => {
    loadPacks();
  }, []);

  const loadPacks = async () => {
    try {
      const res = await api.getStampPacks();
      setPacks(res.packs);
      if (res.packs.length > 0) {
        selectPack(res.packs[0]);
      }
    } catch (err) {
      console.error('Load packs error:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectPack = async (pack) => {
    setSelectedPack(pack.id);
    try {
      const res = await api.getStampPack(pack.id);
      setStamps(res.stamps);
    } catch (err) {
      console.error('Load stamps error:', err);
    }
  };

  const handleStampClick = (stamp) => {
    if (contextMenu) return;
    onSelect(stamp);
    onClose();
  };

  const canEdit = (pack) => {
    return pack?.created_by === user?.id || user?.role === 'admin';
  };

  const currentPack = packs.find(p => p.id === selectedPack);

  // Pack context menu (long press on pack tab)
  const showPackMenu = (e, pack) => {
    if (!canEdit(pack)) return;
    e.preventDefault();
    setContextMenu({ type: 'pack', pack, x: e.clientX || e.touches?.[0]?.clientX, y: e.clientY || e.touches?.[0]?.clientY });
  };

  // Stamp context menu (long press on individual stamp)
  const showStampMenu = (e, stamp) => {
    if (!canEdit(currentPack)) return;
    e.preventDefault();
    setContextMenu({ type: 'stamp', stamp, x: e.clientX || e.touches?.[0]?.clientX, y: e.clientY || e.touches?.[0]?.clientY });
  };

  const handleDeletePack = async () => {
    const pack = contextMenu.pack;
    setContextMenu(null);
    if (!confirm(`スタンプパック「${pack.name}」を削除しますか？\n過去のトークでは表示されなくなります。`)) return;
    try {
      await api.deleteStampPack(pack.id);
      loadPacks();
    } catch (err) {
      console.error('Delete pack error:', err);
    }
  };

  const handleRenamePack = async () => {
    const pack = contextMenu.pack;
    setContextMenu(null);
    const newName = prompt('新しいパック名を入力', pack.name);
    if (!newName || !newName.trim() || newName.trim() === pack.name) return;
    try {
      await api.renameStampPack(pack.id, newName.trim());
      loadPacks();
    } catch (err) {
      console.error('Rename pack error:', err);
    }
  };

  const handleDeleteStamp = async () => {
    const stamp = contextMenu.stamp;
    setContextMenu(null);
    if (!confirm(`スタンプ「${stamp.label}」を削除しますか？`)) return;
    try {
      await api.deleteStamp(stamp.id);
      // Reload current pack
      const res = await api.getStampPack(selectedPack);
      setStamps(res.stamps);
    } catch (err) {
      console.error('Delete stamp error:', err);
    }
  };

  if (showGenerator) {
    return <StampGenerator onClose={() => { setShowGenerator(false); loadPacks(); }} />;
  }

  return (
    <div className="stamp-picker">
      <div className="stamp-picker-header">
        <span>スタンプ</span>
        <button className="stamp-picker-add" onClick={() => setShowGenerator(true)} title="スタンプを作成">
          +
        </button>
        <button className="stamp-picker-close" onClick={onClose}>✕</button>
      </div>

      {loading ? (
        <div className="stamp-picker-loading">読み込み中...</div>
      ) : packs.length === 0 ? (
        <div className="stamp-picker-empty">
          <p>スタンプがありません</p>
          <button className="stamp-picker-create-btn" onClick={() => setShowGenerator(true)}>
            AIでスタンプを作成
          </button>
        </div>
      ) : (
        <>
          <div className="stamp-grid">
            {stamps.map(stamp => (
              <div
                key={stamp.id}
                className="stamp-grid-item"
                onClick={() => handleStampClick(stamp)}
                onContextMenu={(e) => showStampMenu(e, stamp)}
                onTouchStart={(e) => {
                  longPressTimer.current = setTimeout(() => showStampMenu(e, stamp), LONG_PRESS_TIMEOUT);
                }}
                onTouchEnd={() => { clearTimeout(longPressTimer.current); }}
                onTouchMove={() => { clearTimeout(longPressTimer.current); }}
                title={stamp.label}
              >
                <img src={`/media/${stamp.file_path}`} alt={stamp.label} loading="lazy" />
              </div>
            ))}
          </div>

          <div className="stamp-pack-tabs">
            {packs.map(pack => (
              <button
                key={pack.id}
                className={`stamp-pack-tab ${selectedPack === pack.id ? 'active' : ''}`}
                onClick={() => selectPack(pack)}
                onContextMenu={(e) => showPackMenu(e, pack)}
                onTouchStart={(e) => {
                  longPressTimer.current = setTimeout(() => showPackMenu(e, pack), LONG_PRESS_TIMEOUT);
                }}
                onTouchEnd={() => { clearTimeout(longPressTimer.current); }}
                onTouchMove={() => { clearTimeout(longPressTimer.current); }}
                title={pack.name}
              >
                {pack.thumbnail_path ? (
                  <img src={`/media/${pack.thumbnail_path}`} alt={pack.name} />
                ) : (
                  <span>📦</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {contextMenu && (
        <div className="stamp-context-overlay" onClick={() => setContextMenu(null)}>
          <div
            className="stamp-context-menu"
            style={{ bottom: 60, right: 10 }}
            onClick={e => e.stopPropagation()}
          >
            {contextMenu.type === 'pack' && (
              <>
                <button className="stamp-context-item" onClick={handleRenamePack}>
                  <Pencil size={14} /> 名前を変更
                </button>
                <button className="stamp-context-item danger" onClick={handleDeletePack}>
                  <Trash2 size={14} /> パックを削除
                </button>
              </>
            )}
            {contextMenu.type === 'stamp' && (
              <button className="stamp-context-item danger" onClick={handleDeleteStamp}>
                <Trash2 size={14} /> このスタンプを削除
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StampPicker;

import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import StampGenerator from './StampGenerator';
import './StampPicker.css';

function StampPicker({ onSelect, onClose }) {
  const [packs, setPacks] = useState([]);
  const [selectedPack, setSelectedPack] = useState(null);
  const [stamps, setStamps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerator, setShowGenerator] = useState(false);

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
    onSelect(stamp);
    onClose();
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
    </div>
  );
}

export default StampPicker;

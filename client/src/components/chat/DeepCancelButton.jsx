import { useState } from 'react';
import { Square } from 'lucide-react';
import { api } from '../../services/api';
import './DeepCancelButton.css';

function DeepCancelButton({ roomId }) {
  const [busy, setBusy] = useState(false);

  const handleCancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.cancelAgent(roomId);
    } catch (err) {
      console.error('Cancel error:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="deep-cancel-button"
      onClick={handleCancel}
      disabled={busy}
      title="分析を中断"
      aria-label="分析を中断"
    >
      <Square size={12} fill="currentColor" />
      <span>{busy ? '中断中...' : '中断'}</span>
    </button>
  );
}

export default DeepCancelButton;

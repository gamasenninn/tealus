/**
 * 実行中の agent を中断するボタン。
 *
 * #250 で Deep 用に入れたが、通常応答 (Light) も同じ `/agent/cancel` で止まるようになったので
 * 名前を Agent に広げた。表示条件は ChatRoom 側 (agentStatus が非 null = 走行中)。
 */
import { useState } from 'react';
import { Square } from 'lucide-react';
import { api } from '../../services/api';
import './AgentCancelButton.css';

interface AgentCancelButtonProps {
  roomId: string;
}

function AgentCancelButton({ roomId }: AgentCancelButtonProps) {
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
      className="agent-cancel-button"
      onClick={handleCancel}
      disabled={busy}
      title="応答を中断"
      aria-label="応答を中断"
    >
      <Square size={12} fill="currentColor" />
      <span>{busy ? '中断中...' : '中断'}</span>
    </button>
  );
}

export default AgentCancelButton;

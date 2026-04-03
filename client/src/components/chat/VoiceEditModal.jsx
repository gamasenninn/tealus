import { useState } from 'react';
import { api } from '../../services/api';
import { useMessageStore } from '../../stores/messageStore';

function VoiceEditModal({ messageId, initialText, onClose }) {
  const [editText, setEditText] = useState(initialText);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      const data = await api.editTranscription(messageId, editText.trim());
      useMessageStore.getState().updateTranscription(messageId, {
        formatted_text: data.transcription.formatted_text,
        version: data.transcription.version,
        status: 'done',
      });
      onClose();
    } catch (err) {
      console.error('Edit error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box voice-edit-modal" onClick={e => e.stopPropagation()}>
        <h3>文字起こしを編集</h3>
        <textarea
          value={editText}
          onChange={e => setEditText(e.target.value)}
          rows={6}
          autoFocus
        />
        <div className="voice-edit-buttons">
          <button className="btn-cancel" onClick={onClose}>キャンセル</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '確定'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default VoiceEditModal;

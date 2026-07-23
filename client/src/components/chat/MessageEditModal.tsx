import { useState } from 'react';

interface MessageEditModalProps {
  initialText: string;
  onConfirm: (text: string) => void | Promise<void>;
  onClose: () => void;
}

/**
 * #344 候補3: メッセージ編集モーダル (MessageBubble から分離)。
 * 本文の編集状態はこのモーダル内に閉じ、確定時に onConfirm(text) を呼ぶ。
 */
function MessageEditModal({ initialText, onConfirm, onClose }: MessageEditModalProps) {
  const [text, setText] = useState(initialText);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box voice-edit-modal message-edit-modal" onClick={e => e.stopPropagation()}>
        <h3>メッセージを編集</h3>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={12}
          autoFocus
        />
        <div className="voice-edit-buttons">
          <button className="btn-cancel" onClick={onClose}>キャンセル</button>
          <button className="btn-primary" onClick={() => onConfirm(text)} disabled={!text.trim()}>確定</button>
        </div>
      </div>
    </div>
  );
}

export default MessageEditModal;

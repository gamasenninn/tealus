import { diffChars } from 'diff';
import { buildEditDiffPairs, type MessageEditEntry } from '../../utils/editHistory';

interface EditHistoryModalProps {
  editHistory: MessageEditEntry[];
  /** diff の nextText に使う現在の本文 (message.content ?? '') */
  currentContent: string;
  /** 履歴が無いときの「原文」表示に使う本文 (message.content) */
  originalFallback: string | null;
  onClose: () => void;
}

/**
 * #344 候補3: 編集履歴モーダル (MessageBubble から分離)。
 * diff ペアリングは utils/editHistory の buildEditDiffPairs (純関数・テスト済) に委譲。
 */
function EditHistoryModal({ editHistory, currentContent, originalFallback, onClose }: EditHistoryModalProps) {
  const pairs = buildEditDiffPairs(editHistory, currentContent);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box voice-history-modal" onClick={e => e.stopPropagation()}>
        <h3>編集履歴</h3>
        <div className="edit-history-list">
          {pairs.map(({ version, label, editorName, editorDate, prevText, nextText }) => (
            <div key={version} className="edit-history-item">
              <div className="edit-history-header">
                <span>{label}{editorName ? ` — ${editorName}` : ''}</span>
                <span>{editorDate ? new Date(editorDate).toLocaleString('ja-JP') : ''}</span>
              </div>
              <div className="edit-history-diff">
                {diffChars(prevText, nextText).map((part, j) => (
                  <span key={j} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}>{part.value}</span>
                ))}
              </div>
            </div>
          ))}
          <div className="edit-history-item">
            <div className="edit-history-header"><span>原文</span></div>
            <p>{editHistory.length > 0 ? editHistory[editHistory.length - 1].content : originalFallback}</p>
          </div>
        </div>
        <button className="btn-cancel" style={{ width: '100%', marginTop: '12px' }} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

export default EditHistoryModal;

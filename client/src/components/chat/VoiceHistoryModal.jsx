import { diffChars } from 'diff';

function VoiceHistoryModal({ history, onClose }) {
  const original = history[history.length - 1];
  const originalText = original ? (original.formatted_text || original.raw_text || '') : '';
  const diffs = history.slice(0, -1);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box voice-history-modal" onClick={e => e.stopPropagation()}>
        <h3>文字起こし編集履歴</h3>
        <div className="voice-history-list">
          {diffs.map((h, i) => {
            const text = h.formatted_text || h.raw_text || '';
            const prevH = history[i + 1];
            const prevText = prevH ? (prevH.formatted_text || prevH.raw_text || '') : '';
            return (
              <div key={h.version} className="voice-history-item">
                <div className="voice-history-header">
                  <span className="voice-history-diff-label">v{prevH.version} → v{h.version}</span>
                  {h.edited_by_name && <span className="voice-history-editor">by {h.edited_by_name}</span>}
                </div>
                <div className="voice-history-diff-content">
                  {diffChars(prevText, text).map((part, j) => (
                    <span
                      key={j}
                      className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}
                    >{part.value}</span>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="voice-history-item">
            <div className="voice-history-header">
              <span className="voice-history-version">v1（原文）</span>
            </div>
            <div className="voice-history-text">{originalText}</div>
          </div>
        </div>
        <button className="btn-cancel" style={{ width: '100%', marginTop: '12px' }} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

export default VoiceHistoryModal;

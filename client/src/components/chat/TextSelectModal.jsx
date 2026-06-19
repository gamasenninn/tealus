import { useRef, useEffect } from 'react';

/**
 * 部分コピー用オーバーレイ (#部分コピー)
 *
 * バブルは長押し=メニュー / ダブルタップ=幅拡張のため user-select:none にしている。
 * 部分選択はこの専用オーバーレイで行う: 全文を選択可能な read-only textarea に出し、
 * OS ネイティブ選択（ドラッグ範囲指定・コピー）で部分コピーする。ジェスチャ衝突ゼロ、
 * モバイル/PC 共通。
 */
function TextSelectModal({ text, onClose }) {
  const taRef = useRef(null);

  // 開いたら focus（選択 UI をすぐ使えるように）。全選択はしない（部分が主目的）。
  useEffect(() => {
    if (taRef.current) taRef.current.focus();
  }, []);

  const selectAll = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  };

  const rows = Math.min(14, Math.max(3, (text || '').split('\n').length + 1));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>部分コピー</h3>
        <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--text-secondary, #888)' }}>
          ドラッグで範囲を選んでコピーしてください。
        </p>
        <textarea
          ref={taRef}
          readOnly
          value={text}
          rows={rows}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '10px 12px',
            border: '1px solid var(--border-medium, #ccc)',
            borderRadius: '8px',
            fontSize: 'var(--chat-font-size, 16px)',
            lineHeight: 1.6,
            resize: 'vertical',
            userSelect: 'text',
            WebkitUserSelect: 'text',
            WebkitTouchCallout: 'default',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
          <button className="btn-cancel" onClick={selectAll}>全選択</button>
          <button className="btn-primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

export default TextSelectModal;

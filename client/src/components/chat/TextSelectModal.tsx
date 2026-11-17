import { useRef, useEffect } from 'react';

interface TextSelectModalProps {
  text: string;
  onClose: () => void;
}

/**
 * 部分コピー用オーバーレイ (#部分コピー)
 *
 * バブルは長押し=メニュー / ダブルタップ=幅拡張のため user-select:none にしている。
 * 部分選択はこの専用オーバーレイで行う: 全文を選択可能な read-only textarea に出し、
 * OS ネイティブ選択（ドラッグ範囲指定・コピー）で部分コピーする。ジェスチャ衝突ゼロ、
 * モバイル/PC 共通。
 */
function TextSelectModal({ text, onClose }: TextSelectModalProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

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

  // ★ 2026-11-17 小野さん「通常のメッセージ編集と同じくらいの大きさに。その方がコピーしやすい」。
  //   大きさは編集の窓 (MessageEditModal) と同じクラス voice-edit-modal に任せる
  //   (PC は 80vh・幅 720px、スマホは見えている領域を埋める。VoiceBubble.css)。
  //   ★ 箱の大きさ・枠・伸び縮みをここの style に書くと、そのクラスの指定が効かなくなる
  //   rows は visualViewport も PC の指定も無い環境向けの控え (編集の窓と同じ 6)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box voice-edit-modal" onClick={(e) => e.stopPropagation()}>
        <h3>部分コピー</h3>
        <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--text-secondary, #888)' }}>
          ドラッグで範囲を選んでコピーしてください。
        </p>
        <textarea
          ref={taRef}
          readOnly
          value={text}
          rows={6}
          style={{
            userSelect: 'text',
            WebkitUserSelect: 'text',
            WebkitTouchCallout: 'default',
          }}
        />
        <div className="voice-edit-buttons">
          <button className="btn-cancel" onClick={selectAll}>全選択</button>
          <button className="btn-primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

export default TextSelectModal;

import { useEffect, useRef } from 'react';
import { useConfirmStore } from '../../stores/confirmStore';
import './ConfirmModal.css';

function ConfirmModal() {
  const state = useConfirmStore((s) => s.state);
  const _resolve = useConfirmStore((s) => s._resolve);
  const okBtnRef = useRef(null);
  const cancelBtnRef = useRef(null);

  useEffect(() => {
    if (!state) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        _resolve(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        _resolve(true);
      }
    };
    window.addEventListener('keydown', onKey);
    // 初期フォーカス: danger 時は誤操作防止のため cancel に当てる
    const target = state.danger ? cancelBtnRef.current : okBtnRef.current;
    target?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [state, _resolve]);

  if (!state) return null;

  return (
    <div className="modal-overlay confirm-overlay" onClick={() => _resolve(false)}>
      <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
        {state.title && <h3>{state.title}</h3>}
        <div className="confirm-body">{state.body}</div>
        <div className="confirm-actions">
          <button
            ref={cancelBtnRef}
            type="button"
            className="btn-cancel"
            onClick={() => _resolve(false)}
          >
            {state.cancelLabel || 'キャンセル'}
          </button>
          <button
            ref={okBtnRef}
            type="button"
            className={state.danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => _resolve(true)}
          >
            {state.okLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;

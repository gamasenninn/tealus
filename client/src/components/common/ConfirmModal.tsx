import { useEffect, useRef, useState } from 'react';
import { useConfirmStore } from '../../stores/confirmStore';
import './ConfirmModal.css';

function ConfirmModal() {
  const state = useConfirmStore((s) => s.state);
  const _resolve = useConfirmStore((s) => s._resolve);
  const okBtnRef = useRef<HTMLButtonElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // #485-5 prompt() の代わりの入力欄。開くたびに初期値へ戻す
  const [text, setText] = useState('');
  const textRef = useRef('');
  textRef.current = text;

  useEffect(() => {
    if (!state) return;
    setText(state.input?.defaultValue ?? '');
    textRef.current = state.input?.defaultValue ?? '';
    const hasInput = !!state.input;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        _resolve(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        _resolve(true, hasInput ? textRef.current : undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    // 初期フォーカス: 入力欄があればそこ、danger 時は誤操作防止のため cancel に当てる
    const target = hasInput ? inputRef.current : state.danger && !state.hideCancel ? cancelBtnRef.current : okBtnRef.current;
    target?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [state, _resolve]);

  if (!state) return null;
  const ok = () => _resolve(true, state.input ? text : undefined);

  return (
    <div className="modal-overlay confirm-overlay" onClick={() => _resolve(false)}>
      <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
        {state.title && <h3>{state.title}</h3>}
        <div className="confirm-body">{state.body}</div>
        {state.input && (
          <input
            ref={inputRef}
            type="text"
            className="confirm-input"
            value={text}
            placeholder={state.input.placeholder}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className="confirm-actions">
          {!state.hideCancel && (
            <button
              ref={cancelBtnRef}
              type="button"
              className="btn-cancel"
              onClick={() => _resolve(false)}
            >
              {state.cancelLabel || 'キャンセル'}
            </button>
          )}
          <button
            ref={okBtnRef}
            type="button"
            className={state.danger ? 'btn-danger' : 'btn-primary'}
            onClick={ok}
          >
            {state.okLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;

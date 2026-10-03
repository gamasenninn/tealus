import { useEffect } from 'react';

/**
 * #485-6 開いているあいだ Esc で閉じる。
 * 部屋の一覧の右クリック (長押し) メニューは、外をクリックしないと閉じなかった。
 */
export function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

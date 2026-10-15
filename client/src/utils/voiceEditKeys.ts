/**
 * #604 音声メッセージの編集画面のキーボードのショートカット (PC、利用者判断 2026-10-15)。
 *
 *   Alt+→ / Alt+←  次 / 前        (テキスト欄の中でも外でも。ブラウザの戻る・進むは画面側で止める)
 *   Ctrl+Enter      確定           (⌘+Enter も。メッセージの送信と同じ)
 *   Esc             戻る
 *   Ctrl+Space      再生 / 一時停止
 *   テキスト欄の外: ← / → で前 / 次、Space で再生 / 一時停止 (画像ビューアと同じ)
 *
 * ★ 日本語の変換中 (isComposing) は何も拾わない。Enter・Esc は変換の確定・取り消しに使う
 * ★ テキスト欄の中では、修飾キーなしの矢印・Enter・Space は文字の操作のまま
 * ★ ボタンにフォーカスがあるときは、修飾キーなしの Space・矢印は拾わない (Space はそのボタンを押す動き)
 */
export type VoiceEditKeyAction = 'next' | 'prev' | 'confirm' | 'back' | 'toggle';

export interface KeyLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

export function voiceEditKeyAction(
  e: KeyLike,
  { inTextarea, onButton = false }: { inTextarea: boolean; onButton?: boolean },
): VoiceEditKeyAction | null {
  if (e.isComposing) return null;
  if (e.key === 'Escape') return 'back';
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key === 'ArrowRight') return 'next';
    if (e.key === 'ArrowLeft') return 'prev';
    return null;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') return 'confirm';
  if (e.ctrlKey && e.key === ' ') return 'toggle';
  // ここから修飾キーなし: テキスト欄・ボタンの上では元の動きのまま
  if (inTextarea || onButton || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.key === 'ArrowRight') return 'next';
  if (e.key === 'ArrowLeft') return 'prev';
  if (e.key === ' ') return 'toggle';
  return null;
}

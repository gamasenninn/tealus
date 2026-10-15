/**
 * #604 音声メッセージの編集画面のキーボードのショートカット (PC、利用者判断 2026-10-15)。
 *
 *   Alt+→ / Alt+←  次 / 前        (テキスト欄の中でも外でも。ブラウザの戻る・進むは画面側で止める)
 *   Ctrl+Enter      確定           (⌘+Enter も。メッセージの送信と同じ)
 *   Esc             戻る
 *   Ctrl+Space      再生 / 一時停止
 *   Alt+, / Alt+.   10 秒戻す / 送る (2026-10-15。押したキーの場所 (code) で見る。Mac の Option では別の文字になる)
 *   テキスト欄の外: ← / → で前 / 次、Space で再生 / 一時停止 (画像ビューアと同じ)
 *
 * ★ 日本語の変換中 (isComposing) は何も拾わない。Enter・Esc は変換の確定・取り消しに使う
 * ★ テキスト欄の中では、修飾キーなしの矢印・Enter・Space は文字の操作のまま
 * ★ ボタンにフォーカスがあるときは、修飾キーなしの Space・矢印は拾わない (Space はそのボタンを押す動き)
 */
export type VoiceEditKeyAction = 'next' | 'prev' | 'confirm' | 'back' | 'toggle' | 'back10' | 'fwd10';

export interface KeyLike {
  key: string;
  /** 押したキーの場所 (KeyboardEvent.code)。Alt+, / Alt+. の判定に使う */
  code?: string;
  /** KeyboardEvent.keyCode。229 = 日本語入力 (IME) が受け取ったキー */
  keyCode?: number;
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
  // ★ 変換中は拾わない。keyCode 229 も変換中とみなすが、**修飾キー (Alt / Ctrl / ⌘) つきは除く**:
  //   日本語入力がオンだと、記号のキーは変換していなくても key=Process / keyCode 229 で届く。
  //   229 を一律に捨てていた頃は Alt+, / Alt+. が効かなかった (10-15 実機)。本当の変換中は isComposing が立つ
  const modified = e.altKey || e.ctrlKey || e.metaKey;
  if (e.isComposing || (e.keyCode === 229 && !modified)) return null;
  if (e.key === 'Escape') return 'back';
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key === 'ArrowRight') return 'next';
    if (e.key === 'ArrowLeft') return 'prev';
    if (e.code === 'Comma' || e.key === ',') return 'back10';
    if (e.code === 'Period' || e.key === '.') return 'fwd10';
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

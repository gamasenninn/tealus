/**
 * Confirm Store — window.confirm() の代替として promise ベースの確認モーダルを提供。
 *
 * Why: ブラウザ native の confirm() はホスト名が露出する (Chrome モバイル等)、
 * デザイン制御不可、表現力が OK/Cancel 二択のみで詰まる。
 *
 * 使い方:
 *   const confirm = useConfirm();
 *   const ok = await confirm({ body: '削除しますか？', danger: true });
 *
 * 並行 confirm: 古い方を false で resolve し新しい方に置換 (last-wins)。
 */
import { create } from 'zustand';

export interface ConfirmOptions {
  title?: string;
  body: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** #485-5 知らせるだけ (OK のみ)。alert() の代わり */
  hideCancel?: boolean;
  /** #485-5 文字を入れてもらう。prompt() の代わり (promptText から使う) */
  input?: { defaultValue?: string; placeholder?: string };
}

interface ConfirmModalState extends ConfirmOptions {
  /** text は入力欄があるときだけ渡る */
  resolve: (value: boolean, text?: string) => void;
}

interface ConfirmState {
  state: ConfirmModalState | null;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  _resolve: (value: boolean, text?: string) => void;
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  state: null,

  confirm: (opts) => new Promise<boolean>((resolve) => {
    const prev = get().state;
    if (prev) prev.resolve(false);
    set({ state: { ...opts, resolve } });
  }),

  _resolve: (value, text) => {
    const s = get().state;
    if (s) s.resolve(value, text);
    set({ state: null });
  },
}));

export const useConfirm = () => useConfirmStore((s) => s.confirm);

/** #485-5 知らせるだけ (alert の代わり)。OK を押すと解決する */
export function notify(body: string, title?: string): Promise<void> {
  return useConfirmStore.getState().confirm({ body, title, hideCancel: true }).then(() => undefined);
}

/** #485-5 文字を入れてもらう (prompt の代わり)。OK で入れた文字、キャンセルで null */
export function promptText(opts: { body: string; title?: string; defaultValue?: string; placeholder?: string }): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const store = useConfirmStore;
    const prev = store.getState().state;
    if (prev) prev.resolve(false);
    store.setState({
      state: {
        body: opts.body,
        title: opts.title,
        input: { defaultValue: opts.defaultValue, placeholder: opts.placeholder },
        resolve: (ok, text) => resolve(ok ? (text ?? '') : null),
      },
    });
  });
}

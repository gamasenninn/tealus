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
}

interface ConfirmModalState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmState {
  state: ConfirmModalState | null;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  _resolve: (value: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  state: null,

  confirm: (opts) => new Promise<boolean>((resolve) => {
    const prev = get().state;
    if (prev) prev.resolve(false);
    set({ state: { ...opts, resolve } });
  }),

  _resolve: (value) => {
    const s = get().state;
    if (s) s.resolve(value);
    set({ state: null });
  },
}));

export const useConfirm = () => useConfirmStore((s) => s.confirm);

import type { AppUrl } from '../types';

/** 部屋の設定のアプリ一覧に対する操作 (改善ループ 76、#649 C) */
export type AppUrlsAction =
  | { kind: 'toggle'; index: number; field: 'auto_open' | 'wake_lock' | 'pass' }
  | { kind: 'ratio'; index: number; ratio: string | number }
  | { kind: 'add'; title: string; url: string }
  | { kind: 'update'; index: number; title: string; url: string }
  | { kind: 'remove'; index: number };

/**
 * アプリ一覧を作り替える (改善ループ 76、#649 C)。元の一覧は書き換えない。
 * ★ 以前は 7 本の手続きがそれぞれ一覧を作り替えていて、テストが 0 だった。
 * ★ 範囲外の番号は何も変えない (古い一覧の番号で、別のアプリを触らない)
 */
export function editAppUrls(list: AppUrl[], action: AppUrlsAction): AppUrl[] {
  if (action.kind === 'add') {
    return [...list, { title: action.title.trim(), url: action.url.trim(), ratio: 50, auto_open: false, wake_lock: false }];
  }
  if (action.index < 0 || action.index >= list.length) return list;
  switch (action.kind) {
    case 'toggle':
      return list.map((app, i) => (i === action.index ? { ...app, [action.field]: !app[action.field] } : app));
    case 'ratio':
      return list.map((app, i) => (i === action.index ? { ...app, ratio: typeof action.ratio === 'number' ? action.ratio : parseInt(action.ratio) } : app));
    case 'update':
      return list.map((app, i) => (i === action.index ? { ...app, title: action.title.trim(), url: action.url.trim() } : app));
    case 'remove':
      return list.filter((_, i) => i !== action.index);
  }
}

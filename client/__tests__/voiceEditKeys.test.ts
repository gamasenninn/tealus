/**
 * #604 音声メッセージの編集画面のキーボードのショートカット (PC)。
 * キーの読み分けだけを関数にして確かめる (画面は結果に応じてボタンと同じ処理を呼ぶ)
 */
import { describe, it, expect } from 'vitest';
import { voiceEditKeyAction } from '../src/utils/voiceEditKeys';

type K = Partial<{ key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; isComposing: boolean }>;
const k = (e: K, inTextarea = true) => voiceEditKeyAction({ key: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, ...e }, { inTextarea });

describe('voiceEditKeyAction (#604)', () => {
  it('★★ Alt+→ / Alt+← で次 / 前 (テキスト欄の中でも外でも)', () => {
    expect(k({ key: 'ArrowRight', altKey: true })).toBe('next');
    expect(k({ key: 'ArrowLeft', altKey: true })).toBe('prev');
    expect(k({ key: 'ArrowRight', altKey: true }, false)).toBe('next');
  });

  it('★ Ctrl+Enter (⌘+Enter) で確定、Esc で戻る', () => {
    expect(k({ key: 'Enter', ctrlKey: true })).toBe('confirm');
    expect(k({ key: 'Enter', metaKey: true })).toBe('confirm');
    expect(k({ key: 'Escape' })).toBe('back');
  });

  it('★ Ctrl+Space で再生 / 一時停止', () => {
    expect(k({ key: ' ', ctrlKey: true })).toBe('toggle');
  });

  it('★★ テキスト欄の中では、矢印・Enter・Space は文字の操作のまま', () => {
    expect(k({ key: 'ArrowRight' })).toBeNull();
    expect(k({ key: 'ArrowLeft' })).toBeNull();
    expect(k({ key: 'Enter' })).toBeNull();
    expect(k({ key: ' ' })).toBeNull();
    expect(k({ key: 'Enter', shiftKey: true })).toBeNull();
  });

  it('★ テキスト欄の外では ← / → で前 / 次、Space で再生 / 一時停止', () => {
    expect(k({ key: 'ArrowRight' }, false)).toBe('next');
    expect(k({ key: 'ArrowLeft' }, false)).toBe('prev');
    expect(k({ key: ' ' }, false)).toBe('toggle');
  });

  it('★★ 日本語の変換中は何も拾わない (変換の確定・取り消しに使う)', () => {
    expect(k({ key: 'Enter', ctrlKey: true, isComposing: true })).toBeNull();
    expect(k({ key: 'Escape', isComposing: true })).toBeNull();
    expect(k({ key: 'ArrowRight', altKey: true, isComposing: true })).toBeNull();
  });

  it('★ ボタンにフォーカスがあるときは、修飾キーなしの Space・矢印は拾わない (Space はボタンを押す動き)', () => {
    const onButton = (e: K) => voiceEditKeyAction({ key: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, ...e }, { inTextarea: false, onButton: true });
    expect(onButton({ key: ' ' })).toBeNull();
    expect(onButton({ key: 'ArrowRight' })).toBeNull();
    expect(onButton({ key: 'ArrowRight', altKey: true })).toBe('next');
    expect(onButton({ key: 'Escape' })).toBe('back');
  });

  it('関係ないキーは null', () => {
    expect(k({ key: 'a' })).toBeNull();
    expect(k({ key: 'ArrowDown', altKey: true })).toBeNull();
  });
});

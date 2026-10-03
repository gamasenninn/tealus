/**
 * #485-5 ブラウザ本来の alert / prompt を画面内のモーダルに置き換える
 *
 * ★ 確認モーダル (confirmStore) を作った理由は「本来のダイアログはスマホでホスト名が出る・見た目を制御できない」。
 *   それでも alert 4 か所・prompt 1 か所が残っていた。
 * - notify: 知らせるだけ (OK のみ。キャンセルを出さない)
 * - promptText: 文字を入れてもらう (OK で入れた文字、キャンセルで null)
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import ConfirmModal from '../../src/components/common/ConfirmModal';
import { useConfirmStore, notify, promptText } from '../../src/stores/confirmStore';

describe('ConfirmModal — 知らせる / 文字を入れる (#485-5)', () => {
  beforeEach(() => {
    act(() => useConfirmStore.setState({ state: null }));
  });

  it('notify: 本文と OK だけを出し、キャンセルは出さない。OK で閉じる', async () => {
    render(<ConfirmModal />);
    let done = false;
    let p!: Promise<void>;
    act(() => { p = notify('読み上げに失敗しました: 鍵が無い').then(() => { done = true; }); });

    expect(screen.getByText('読み上げに失敗しました: 鍵が無い')).toBeTruthy();
    expect(screen.queryByText('キャンセル')).toBeNull();
    fireEvent.click(screen.getByText('OK'));
    await act(async () => { await p; });
    expect(done).toBe(true);
    expect(screen.queryByText('読み上げに失敗しました: 鍵が無い')).toBeNull();
  });

  it('promptText: 初期値の入った入力欄を出し、OK で入れ直した文字を返す', async () => {
    render(<ConfirmModal />);
    let p!: Promise<string | null>;
    act(() => { p = promptText({ body: '新しいパック名を入力', defaultValue: '古い名前' }); });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('古い名前');
    fireEvent.change(input, { target: { value: '新しい名前' } });
    fireEvent.click(screen.getByText('OK'));
    await expect(p).resolves.toBe('新しい名前');
  });

  it('promptText: キャンセルなら null', async () => {
    render(<ConfirmModal />);
    let p!: Promise<string | null>;
    act(() => { p = promptText({ body: '新しいパック名を入力', defaultValue: 'x' }); });
    fireEvent.click(screen.getByText('キャンセル'));
    await expect(p).resolves.toBeNull();
  });

  it('promptText: 入力欄で Enter を押すと OK と同じ', async () => {
    render(<ConfirmModal />);
    let p!: Promise<string | null>;
    act(() => { p = promptText({ body: '名前', defaultValue: 'abc' }); });
    fireEvent.keyDown(window, { key: 'Enter' });
    await expect(p).resolves.toBe('abc');
  });

  it('★ 従来の confirm はそのまま (true / false)', async () => {
    render(<ConfirmModal />);
    let p!: Promise<boolean>;
    act(() => { p = useConfirmStore.getState().confirm({ body: '消しますか' }); });
    expect(screen.getByText('キャンセル')).toBeTruthy();
    fireEvent.click(screen.getByText('OK'));
    await expect(p).resolves.toBe(true);
  });
});

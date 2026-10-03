import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ContextMenu from '../../src/components/chat/ContextMenu';

// 業務メモ 6/27 小野さん要望: リアクション候補に「完了」を表すアイコンが無い → ✅ を追加。
describe('ContextMenu リアクション候補（完了アイコン）', () => {
  const base = { items: [], position: { x: 0, y: 0 }, onClose: () => {} };

  it('完了を表す ✅ がリアクション候補に含まれる', () => {
    render(<ContextMenu {...base} onReaction={() => {}} />);
    expect(screen.getByRole('button', { name: '✅' })).toBeInTheDocument();
  });

  it('✅ クリックで onReaction("✅") が呼ばれる', () => {
    const onReaction = vi.fn();
    render(<ContextMenu {...base} onReaction={onReaction} />);
    fireEvent.click(screen.getByRole('button', { name: '✅' }));
    expect(onReaction).toHaveBeenCalledWith('✅');
  });
});

// #485-6 の続き: メッセージの長押しメニューも Esc で閉じる (部屋の一覧のメニューだけ直していた。2026-10-03 の UI 試験で見つけた)
describe('ContextMenu — Esc で閉じる', () => {
  it('Esc を押すと onClose が呼ばれる', () => {
    const onClose = vi.fn();
    render(<ContextMenu items={[]} position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ほかのキーでは閉じない', () => {
    const onClose = vi.fn();
    render(<ContextMenu items={[]} position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

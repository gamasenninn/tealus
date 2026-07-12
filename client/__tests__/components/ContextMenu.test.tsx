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

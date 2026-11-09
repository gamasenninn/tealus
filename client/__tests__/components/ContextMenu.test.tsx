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

/**
 * 2026-11-09 小野さん「自分のメッセージをエージェントに送る、が右クリックでできなくなった」
 * ★ マルチトークのパネル (高さ 550px ほど) では、メニュー (絵文字 + 10 項目) が窓より高く、上に 10px 寄せたうえで
 *   はみ出した分が overflow: hidden で切れていた。下の方の「エージェントに送る」「削除」が見えなかった。
 *   窓の高さを上限にして、超えたらメニューの中で縦に動かす
 */
import { readSrc } from '../helpers/srcFiles';

describe('窓より高いメニュー', () => {
  it('★ 高さの上限は窓の高さで、超えたらメニューの中で縦に動かせる', () => {
    const css = readSrc('components/chat/ContextMenu.css');
    const rule = css.slice(css.indexOf('.context-menu {'), css.indexOf('}', css.indexOf('.context-menu {')));
    expect(rule).toMatch(/max-height:\s*calc\(100(vh|dvh) - 20px\)/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });
});

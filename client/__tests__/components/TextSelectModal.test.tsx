/**
 * TextSelectModal の test (#部分コピー)
 *
 * バブルは user-select:none でジェスチャ最適化しているため、部分選択は
 * 専用オーバーレイで行う。全文を選択可能な read-only textarea に出し、
 * OS ネイティブ選択で部分コピーする。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TextSelectModal from '../../src/components/chat/TextSelectModal';

describe('TextSelectModal (#部分コピー)', () => {
  it('テキストを read-only textarea に表示する', () => {
    render(<TextSelectModal text="hello world" onClose={() => {}} />);
    const ta = screen.getByDisplayValue('hello world');
    expect(ta).toBeInTheDocument();
    expect(ta).toHaveAttribute('readonly');
  });

  it('閉じるで onClose を呼ぶ', () => {
    const onClose = vi.fn();
    render(<TextSelectModal text="x" onClose={onClose} />);
    fireEvent.click(screen.getByText('閉じる'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('全選択ボタンがあり、クリックで例外を出さない', () => {
    render(<TextSelectModal text="abc def" onClose={() => {}} />);
    const btn = screen.getByText('全選択');
    expect(() => fireEvent.click(btn)).not.toThrow();
  });
});

/**
 * ★ 2026-11-17 小野さん「部分コピーの窓を、通常のメッセージ編集と同じくらいの大きさに。その方がコピーしやすい」。
 *   大きさは編集の窓 (MessageEditModal) と同じクラス voice-edit-modal で決める (PC は 80vh・幅 720px、
 *   スマホは見えている領域を埋める。VoiceBubble.css)。写しの寸法を持つと、片方だけ直して食い違う
 */
describe('TextSelectModal の大きさ (2026-11-17)', () => {
  it('★ 編集の窓と同じクラスで開く', () => {
    render(<TextSelectModal text="hello" onClose={() => {}} />);
    const box = screen.getByDisplayValue('hello').closest('.modal-box');
    expect(box).toHaveClass('voice-edit-modal');
  });

  it('★ 箱の大きさ・枠・伸び縮みをその場の style で上書きしない (クラスの指定が効かなくなる)', () => {
    render(<TextSelectModal text="hello" onClose={() => {}} />);
    const ta = screen.getByDisplayValue('hello') as HTMLTextAreaElement;
    for (const p of ['width', 'resize', 'padding', 'border', 'font-size', 'height']) {
      expect(ta.style.getPropertyValue(p)).toBe('');
    }
  });
});

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

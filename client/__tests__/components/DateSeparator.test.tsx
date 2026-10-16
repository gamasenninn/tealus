/**
 * #476 日付の札を押すとカレンダーを開く
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DateSeparator from '../../src/components/chat/DateSeparator';

describe('DateSeparator (#476)', () => {
  it('★ 押せる札はボタンで、押すと onClick が呼ばれる', () => {
    const onClick = vi.fn();
    render(<DateSeparator date="2026-09-12T03:00:00Z" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /日付へ移動/ }));
    expect(onClick).toHaveBeenCalled();
  });

  it('onClick が無ければボタンにしない (今までどおり)', () => {
    render(<DateSeparator date="2026-09-12T03:00:00Z" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('★ 押せる札には暦の印と「押すと日付へ」の説明が付く (10-16: 見た目で押せると分からなかった)', () => {
    const { container } = render(<DateSeparator date="2026-09-12T03:00:00Z" onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: /日付へ移動/ });
    expect(btn.querySelector('.date-separator-icon')).not.toBeNull();
    expect(btn).toHaveAttribute('title', '押すと日付を選んで移動できます');
    expect(container.querySelector('.date-separator-icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('押せない札には印を付けない', () => {
    const { container } = render(<DateSeparator date="2026-09-12T03:00:00Z" />);
    expect(container.querySelector('.date-separator-icon')).toBeNull();
  });

  it('★ 上に貼り付ける札には sticky の印が付く', () => {
    const { container } = render(<DateSeparator date="2026-09-12T03:00:00Z" sticky onClick={() => {}} />);
    expect(container.querySelector('.date-separator.sticky')).not.toBeNull();
  });
});

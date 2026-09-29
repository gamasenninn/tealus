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

  it('★ 上に貼り付ける札には sticky の印が付く', () => {
    const { container } = render(<DateSeparator date="2026-09-12T03:00:00Z" sticky onClick={() => {}} />);
    expect(container.querySelector('.date-separator.sticky')).not.toBeNull();
  });
});

/**
 * MessageErrorBoundary の test (#306)
 *
 * 1 件のメッセージ描画で例外が出ても、チャット全体を白紙化せず
 * 当該メッセージだけ fallback に差し替える（残りは表示継続）。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MessageErrorBoundary from '../../src/components/chat/MessageErrorBoundary';

function Boom() {
  throw new Error('render fail');
}

describe('MessageErrorBoundary (#306)', () => {
  it('子が throw したら fallback を表示する', () => {
    // error boundary は componentDidCatch で console.error を出すので抑制
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MessageErrorBoundary messageId="m1">
        <Boom />
      </MessageErrorBoundary>
    );
    expect(screen.getByText(/表示できませんでした/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('正常な子はそのまま表示する', () => {
    render(
      <MessageErrorBoundary messageId="m2">
        <div>正常メッセージ</div>
      </MessageErrorBoundary>
    );
    expect(screen.getByText('正常メッセージ')).toBeInTheDocument();
  });
});

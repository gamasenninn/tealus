/**
 * #525 一番外の受け止め。
 * ★ 以前は、メッセージ 1 件とトランシーバーの表示の外で描画が失敗すると、画面全体が真っ白になった。
 *   今は「読み込み直す」を出し、何が起きたかを本体のログへ送る。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const report = vi.fn();
vi.mock('../../src/services/errorReport', () => ({ reportClientError: (...a: unknown[]) => report(...a) }));

import AppErrorBoundary from '../../src/components/AppErrorBoundary';
import MessageErrorBoundary from '../../src/components/chat/MessageErrorBoundary';
import TransceiverErrorBoundary from '../../src/components/chat/TransceiverErrorBoundary';

function Boom(): never {
  throw new Error('render fail');
}

describe('AppErrorBoundary (#525)', () => {
  beforeEach(() => report.mockClear());

  it('★ 子が落ちたら真っ白にせず「読み込み直す」を出し、本体へ送る', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByRole('button', { name: '読み込み直す' })).toBeInTheDocument();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toBe('render');
    expect((report.mock.calls[0][1] as Error).message).toBe('render fail');
    spy.mockRestore();
  });

  it('「読み込み直す」で画面を読み込み直す', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, writable: true });
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: '読み込み直す' }));
    expect(reload).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('正常な子はそのまま表示し、何も送らない', () => {
    render(<AppErrorBoundary><div>ふつうの画面</div></AppErrorBoundary>);
    expect(screen.getByText('ふつうの画面')).toBeInTheDocument();
    expect(report).not.toHaveBeenCalled();
  });

  it('★ 既存の受け止め (メッセージ 1 件 / トランシーバー) も本体へ送る', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MessageErrorBoundary messageId="m1"><Boom /></MessageErrorBoundary>);
    render(<TransceiverErrorBoundary><Boom /></TransceiverErrorBoundary>);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls.every((c) => c[0] === 'render')).toBe(true);
    spy.mockRestore();
  });
});

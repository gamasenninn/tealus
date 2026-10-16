/**
 * #546 この端末にプッシュの宛先が無いとき、タップで登録し直せるボタン。
 * ★ iPhone は利用者のタップなしでは宛先を作れない。外れてしまった端末の戻し道がこれまで無かった
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getPushState = vi.fn();
const registerPushNotification = vi.fn();
const refreshPushSubscription = vi.fn();
vi.mock('../../src/services/pushNotification', () => ({
  getPushState: () => getPushState(),
  registerPushNotification: () => registerPushNotification(),
  refreshPushSubscription: (...a: unknown[]) => refreshPushSubscription(...a),
}));

import PushSubscribeButton from '../../src/components/profile/PushSubscribeButton';

describe('PushSubscribeButton (#546)', () => {
  beforeEach(() => { getPushState.mockReset(); registerPushNotification.mockReset(); refreshPushSubscription.mockReset(); });

  it('★ 宛先がある端末でも「登録し直す」を出す (10-16: 端末に宛先があっても本体側で外れていることがある)', async () => {
    getPushState.mockResolvedValue('subscribed');
    refreshPushSubscription.mockResolvedValue(true);
    render(<PushSubscribeButton />);
    expect(await screen.findByText(/この端末には通知の宛先があります/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '登録し直す' }));
    expect(refreshPushSubscription).toHaveBeenCalledWith(expect.any(Number), { force: true });
    expect(await screen.findByText(/送り直しました/)).toBeTruthy();
  });

  it('★ 宛先が無い端末ではボタンを出し、タップで登録する', async () => {
    getPushState.mockResolvedValue('none');
    registerPushNotification.mockResolvedValue('ok');
    render(<PushSubscribeButton />);
    fireEvent.click(await screen.findByRole('button', { name: 'この端末で通知を受け取る' }));
    expect(registerPushNotification).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/この端末には通知の宛先があります/)).toBeTruthy();
  });

  it('許可されていなければ、端末の設定で許可するよう案内する', async () => {
    getPushState.mockResolvedValue('none');
    registerPushNotification.mockResolvedValue('denied');
    render(<PushSubscribeButton />);
    fireEvent.click(await screen.findByRole('button', { name: 'この端末で通知を受け取る' }));
    await waitFor(() => expect(screen.getByText(/端末の設定/)).toBeTruthy());
  });

  it('登録に失敗したら、そう出してボタンを残す', async () => {
    getPushState.mockResolvedValue('none');
    registerPushNotification.mockResolvedValue('failed');
    render(<PushSubscribeButton />);
    fireEvent.click(await screen.findByRole('button', { name: 'この端末で通知を受け取る' }));
    expect(await screen.findByText(/登録できませんでした/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'この端末で通知を受け取る' })).toBeTruthy();
  });

  it('通知に対応していない端末では何も出さない', async () => {
    getPushState.mockResolvedValue('unsupported');
    const { container } = render(<PushSubscribeButton />);
    await waitFor(() => expect(getPushState).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});

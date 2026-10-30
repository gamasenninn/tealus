/**
 * 初めての人に、通知の許可の前に 1 行の案内を出す / iPhone の Safari ではホーム画面に追加を案内する
 * (2026-10-29 小野さん判断 6)
 *
 * ★ 以前はログインした瞬間に、説明なしでブラウザの許可の問いが出た (初めての人は何の許可か分からずブロックしやすい)。
 *   iPhone は Safari のままでは通知が届かないのに、その案内が画面に無かった
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const registerPushNotification = vi.fn(async () => 'ok');
const pushPermission = vi.fn(() => 'default');
const isIosBrowserTab = vi.fn(() => false);
vi.mock('../../src/services/pushNotification', () => ({
  registerPushNotification: () => registerPushNotification(),
  pushPermission: () => pushPermission(),
  isIosBrowserTab: () => isIosBrowserTab(),
}));

const getConfig = vi.fn(() => ({ vapid_public_key: 'k' }));
vi.mock('../../src/services/clientConfig', () => ({ getConfig: () => getConfig() }));

import PushOnboardingBanner from '../../src/components/common/PushOnboardingBanner';

describe('PushOnboardingBanner', () => {
  beforeEach(() => {
    registerPushNotification.mockClear(); pushPermission.mockReturnValue('default'); isIosBrowserTab.mockReturnValue(false);
    getConfig.mockReturnValue({ vapid_public_key: 'k' });
    sessionStorage.clear();
  });

  it('★★ まだ聞いていない端末では案内を出し、押したときだけ許可を求める', () => {
    render(<PushOnboardingBanner />);
    expect(screen.getByText(/許可/)).toBeTruthy();
    expect(registerPushNotification).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '通知を受け取る' }));
    expect(registerPushNotification).toHaveBeenCalledTimes(1);
  });

  it('★ 「あとで」で閉じる (この起動のあいだは出さない)', () => {
    const { unmount } = render(<PushOnboardingBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'あとで' }));
    expect(screen.queryByRole('button', { name: '通知を受け取る' })).toBeNull();
    unmount();
    render(<PushOnboardingBanner />);
    expect(screen.queryByRole('button', { name: '通知を受け取る' })).toBeNull();
  });

  it('許可済み・拒否済みの端末では何も出さない', () => {
    pushPermission.mockReturnValue('granted');
    const { container, rerender } = render(<PushOnboardingBanner />);
    expect(container.textContent).toBe('');
    pushPermission.mockReturnValue('denied');
    rerender(<PushOnboardingBanner />);
    expect(container.textContent).toBe('');
  });

  it('★★ iPhone の Safari (ホーム画面から開いていない) では、ホーム画面に追加を案内する', () => {
    isIosBrowserTab.mockReturnValue(true);
    pushPermission.mockReturnValue('unsupported');
    render(<PushOnboardingBanner />);
    expect(screen.getByText(/ホーム画面に追加/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '通知を受け取る' })).toBeNull();
  });

  it('★ 通知の鍵 (VAPID) の無い Tealus では、iPhone の案内も出さない (案内どおりにしても届かない)', () => {
    getConfig.mockReturnValue({ vapid_public_key: '' });
    isIosBrowserTab.mockReturnValue(true);
    const { container } = render(<PushOnboardingBanner />);
    expect(container.textContent).toBe('');
  });
});

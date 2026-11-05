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

  // ★ 改善ループ 40: 11-03 に iPhone の宛先が 410 で外れた人に、2 日間 195 件の通知が届かなかった。
  //   許可は済んでいる (または切れている) ので、「まだ聞いていない端末」だけを案内する作りでは何も出なかった
  describe('本体が「有効な宛先 0 本」と言うとき (許可の状態に関係なく案内する)', () => {
    it('★★ 許可済みでも 0 本なら、押して登録し直す案内を出す', () => {
      pushPermission.mockReturnValue('granted');
      render(<PushOnboardingBanner activeSubscriptions={0} />);
      expect(screen.getByText(/通知が届いていません/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '通知を受け取る' }));
      expect(registerPushNotification).toHaveBeenCalledTimes(1);
    });

    it('★ 拒否されている端末では、端末の設定で許可する案内を出す (押しても聞けないのでボタンは出さない)', () => {
      pushPermission.mockReturnValue('denied');
      render(<PushOnboardingBanner activeSubscriptions={0} hadSubscriptions />);
      expect(screen.getByText(/設定/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: '通知を受け取る' })).toBeNull();
    });

    // ★ 改善ループ 41: 一度も登録していない人 (通知は要らないと拒否を選んだ人) に、起動のたびに「切れています」と出ていた
    it('★ 一度も登録していない人の拒否には何も出さない (本人が選んだ)', () => {
      pushPermission.mockReturnValue('denied');
      const { container } = render(<PushOnboardingBanner activeSubscriptions={0} hadSubscriptions={false} />);
      expect(container.textContent).toBe('');
    });

    // ★ 改善ループ 41: 押して登録に失敗しても帯が消え、本人には「できた」に見えていた
    it('★ 押して登録できなかったら、帯を消さずに「できませんでした」を出す', async () => {
      pushPermission.mockReturnValue('granted');
      registerPushNotification.mockResolvedValueOnce('failed');
      render(<PushOnboardingBanner activeSubscriptions={0} />);
      fireEvent.click(screen.getByRole('button', { name: '通知を受け取る' }));
      expect(await screen.findByText(/できませんでした/)).toBeTruthy();
    });

    it('押して登録できたら、知らせて帯を消す', async () => {
      pushPermission.mockReturnValue('granted');
      const onRegistered = vi.fn();
      const { container } = render(<PushOnboardingBanner activeSubscriptions={0} onRegistered={onRegistered} />);
      fireEvent.click(screen.getByRole('button', { name: '通知を受け取る' }));
      await vi.waitFor(() => expect(onRegistered).toHaveBeenCalled());
      expect(container.textContent).toBe('');
    });

    it('宛先が 1 本以上あれば、許可済みの端末には何も出さない (今までどおり)', () => {
      pushPermission.mockReturnValue('granted');
      const { container } = render(<PushOnboardingBanner activeSubscriptions={1} />);
      expect(container.textContent).toBe('');
    });
  });

  it('★ 通知の鍵 (VAPID) の無い Tealus では、iPhone の案内も出さない (案内どおりにしても届かない)', () => {
    getConfig.mockReturnValue({ vapid_public_key: '' });
    isIosBrowserTab.mockReturnValue(true);
    const { container } = render(<PushOnboardingBanner />);
    expect(container.textContent).toBe('');
  });
});

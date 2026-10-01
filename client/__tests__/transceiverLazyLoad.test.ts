/**
 * mediasoup-client は、トランシーバー・通話を使い始めたときにだけ読む (2026-10-01)
 *
 * ★ 画面の JS は分けずに 1 本 949 KB で、そのうち mediasoup-client が 175 KB (18%) だった。
 *   使うのは useTransceiver だけで、通話の部品を置かない採用者は一度も使わない
 * ★ 確かめ方: mediasoup-client の差し替えが「読まれたら印を付ける」。
 *   useTransceiver を読み込んだだけでは印が付かない = 最初の 1 本に入っていない
 */
import { describe, it, expect, vi } from 'vitest';

const loaded = { mediasoup: false };
vi.mock('mediasoup-client', () => {
  loaded.mediasoup = true;
  return { Device: class {} };
});

describe('useTransceiver と mediasoup-client', () => {
  it('★ useTransceiver を読み込んだだけでは mediasoup-client を読まない', async () => {
    await import('../src/hooks/useTransceiver');
    expect(loaded.mediasoup).toBe(false);
  });
});

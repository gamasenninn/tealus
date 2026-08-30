/**
 * 中断ボタンを出してよい status か (#399 follow-up、2026-08-30)
 *
 * ★ 背景: #399 で中断ボタンの表示条件を `status === 'analyzing'` (Deep のみ) から
 *   「agentStatus が非 null」に広げた。通常応答でも中断できるようにするため。
 *
 * ★★ ところが agent-server は **cc-bridge の受領表示**にも status を使っていた:
 *
 *     emitCcAck → pushStatus(roomId, 'relayed', 'cc-tealus に届きました。応答をお待ちください…')
 *
 *   これは「このボットが処理中」ではなく「**別セッションへ中継した**」の意味。
 *   走っている agent が無いので、★★★ 押しても何も起きないボタンが 5 秒間出ていた
 *   (2026-08-30 19:37、user が発見)。
 *
 * ★ 直し方は「中継は別の status 値にする」。ここはその値を 1 か所に閉じ込める。
 */
import { describe, test, expect } from 'vitest';
import { isCancellableStatus, RELAYED_STATUS } from '../src/utils/agentStatus';

describe('isCancellableStatus', () => {
  test('★ 中継 (cc-bridge の受領表示) では出さない', () => {
    expect(isCancellableStatus(RELAYED_STATUS)).toBe(false);
    expect(isCancellableStatus('relayed')).toBe(false);
  });

  test('Deep (analyzing) では出す', () => {
    expect(isCancellableStatus('analyzing')).toBe(true);
  });

  test('通常応答の status では出す', () => {
    // agent-server の mapToolToStatus が返す一式
    for (const s of ['thinking', 'processing', 'searching', 'reading', 'sending', 'writing']) {
      expect(isCancellableStatus(s)).toBe(true);
    }
  });

  test('★ 知らない status は出す側に倒す (中断できる方を取りこぼさない)', () => {
    expect(isCancellableStatus('some-future-status')).toBe(true);
  });

  test('idle / 空文字は出さない', () => {
    expect(isCancellableStatus('idle')).toBe(false);
    expect(isCancellableStatus('')).toBe(false);
  });
});

/**
 * 接続の記録に端末 (UA) と通り方を添える (2026-10-23 改善ループ 11 回目)
 *
 * ★ 管理者 1 人の接続が 72 時間で 713 回、うち 231 回は「通知の 2〜3 秒後につないで 3 秒で切る」形だった
 *   (通知 1 回につき 1 回。ほかの人には 0)。宛先は 7 本あり、どの端末かが記録から分からなかった
 */
import { clientLabel } from '../../src/socket/clientLabel.mts';

test('UA と通り方 (websocket / polling) を 1 行にする', () => {
  expect(clientLabel({ headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130' } }, 'websocket'))
    .toBe('transport=websocket ua=Mozilla/5.0 (Linux; Android 14) Chrome/130');
});

test('UA が長ければ 120 字で切る・無ければ -', () => {
  expect(clientLabel({ headers: { 'user-agent': 'x'.repeat(300) } }, 'polling')).toBe(`transport=polling ua=${'x'.repeat(120)}…`);
  expect(clientLabel({ headers: {} }, undefined)).toBe('transport=- ua=-');
});

test('改行は空白にする (記録の 1 行を割らない)', () => {
  expect(clientLabel({ headers: { 'user-agent': 'a\nb' } }, 'websocket')).toBe('transport=websocket ua=a b');
});

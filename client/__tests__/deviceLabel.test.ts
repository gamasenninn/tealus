/**
 * 通知の送り先の登録に、端末名を付ける (2026-09-29)
 *
 * push_subscriptions.device_name は欄だけあって、画面が一度も送っていなかった。
 * ある利用者の有効な登録が 12 件あっても、どれがどの端末かを見分けられず、
 * 「同じ通知が重なって鳴っていないか」を確かめられなかった。
 * ★ UA を丸ごとは入れない (欄は 100 字・読めないため)。OS・ブラウザ・アプリとして開いているかだけ
 */
import { describe, it, expect } from 'vitest';
import { deviceLabel } from '../src/utils/deviceLabel';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 17; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
};

describe('deviceLabel — 通知の登録に付ける端末名', () => {
  it('Android の Chrome', () => {
    expect(deviceLabel(UA.androidChrome, false)).toBe('Android Chrome');
  });
  it('★ ホーム画面のアプリとして開いていれば「アプリ」を付ける (同じ端末でもブラウザとアプリは別の登録になる)', () => {
    expect(deviceLabel(UA.androidChrome, true)).toBe('Android Chrome (アプリ)');
    expect(deviceLabel(UA.iphoneSafari, true)).toBe('iPhone Safari (アプリ)');
  });
  it('Windows の Chrome と Edge を分ける (Edge の UA には Chrome も入っている)', () => {
    expect(deviceLabel(UA.windowsChrome, false)).toBe('Windows Chrome');
    expect(deviceLabel(UA.windowsEdge, false)).toBe('Windows Edge');
  });
  it('Mac の Safari と Firefox', () => {
    expect(deviceLabel(UA.macSafari, false)).toBe('Mac Safari');
    expect(deviceLabel(UA.macFirefox, false)).toBe('Mac Firefox');
  });
  it('分からないものは「不明」(空にしない = 付け忘れと区別できるように)', () => {
    expect(deviceLabel('', false)).toBe('不明');
    expect(deviceLabel('SomeBot/1.0', false)).toBe('不明');
  });
  it('100 字を超えない', () => {
    expect(deviceLabel(UA.androidChrome + 'x'.repeat(500), true).length).toBeLessThanOrEqual(100);
  });
});

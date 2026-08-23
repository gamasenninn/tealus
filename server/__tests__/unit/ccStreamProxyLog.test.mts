/**
 * `/agent-api` proxy の切断ログ (#359 B-1)
 *
 * ★ 何のためのテストか: 3000 番 (本体サーバの proxy) は 8 月の切断調査の間ずっと
 *   **無言**だった。無言は「何も起きていない」と「記録していない」の 2 通りに読めて、
 *   計器が区別していなかった。この関数は **どちら側が先に閉じたか** を必ず書く。
 *
 * ★★ 同着を片側に潰さないこと。project キーで実損が半分になった事故と同じ形で、
 *   「同時に起きた 2 つ」を 1 つに丸めると、後から取り返せない。
 */
import { describeProxyClose } from '../../src/utils/ccStreamProxyLog.mts';

const base = { url: '/cc-queue/stream?project=support', startedAt: 1_000_000, bytes: 4096 };

describe('describeProxyClose', () => {
  test('下流 (client / CF / nginx) が先に閉じたら side=client', () => {
    const line = describeProxyClose({
      ...base, now: 1_012_345, clientClosedAt: 1_012_000, upstreamClosedAt: 1_012_300,
    });
    expect(line).toContain('side=client');
    expect(line).toContain('client=+12.000s');
    expect(line).toContain('upstream=+12.300s');
  });

  test('上流 (agent-server) が先に閉じたら side=upstream', () => {
    const line = describeProxyClose({
      ...base, now: 1_012_345, clientClosedAt: 1_012_300, upstreamClosedAt: 1_012_000,
    });
    expect(line).toContain('side=upstream');
  });

  test('片側しか閉じていなければ、その側。閉じていない側は "-" で明示する', () => {
    const line = describeProxyClose({ ...base, now: 1_005_000, clientClosedAt: 1_004_000 });
    expect(line).toContain('side=client');
    expect(line).toContain('upstream=-');
  });

  test('★ 同着は side=both。どちらかに寄せない', () => {
    const line = describeProxyClose({
      ...base, now: 1_009_000, clientClosedAt: 1_008_000, upstreamClosedAt: 1_008_000,
    });
    expect(line).toContain('side=both');
  });

  test('どちらも閉じていなければ side=unknown (無言にはしない)', () => {
    expect(describeProxyClose({ ...base, now: 1_003_000 })).toContain('side=unknown');
  });

  test('proxy 自身のエラーは side=error として残し、err= に理由を書く', () => {
    const line = describeProxyClose({ ...base, now: 1_007_500, error: 'ECONNRESET' });
    expect(line).toContain('side=error');
    expect(line).toContain('err=ECONNRESET');
  });

  test('★ エラーがあっても、先に閉じた側が分かるならそちらを優先する', () => {
    const line = describeProxyClose({
      ...base, now: 1_007_500, clientClosedAt: 1_007_000, error: 'ECONNRESET',
    });
    expect(line).toContain('side=client');
    expect(line).toContain('err=ECONNRESET');
  });

  test('継続時間はミリ秒まで出す (秒に丸めると Δ が測れない)', () => {
    const line = describeProxyClose({ ...base, now: 1_002_345 });
    expect(line).toContain('dur=2.345s');
  });

  test('行頭は固定 — 既存の grep を壊さないため', () => {
    expect(describeProxyClose({ ...base, now: 1_001_000 })).toMatch(/^\[cc-stream proxy\] closed: /);
  });

  test('バイト数を出す (0 と「記録していない」を区別する)', () => {
    expect(describeProxyClose({ ...base, now: 1_001_000, bytes: 0 })).toContain('bytes=0');
  });
});

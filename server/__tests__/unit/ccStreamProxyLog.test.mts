/**
 * `/agent-api` proxy の切断ログ (#359 B-1)
 *
 * ★ 何のためか: 3000 番は 8 月の切断調査の間ずっと無言で、無言が
 *   「何も起きていない」と「記録していない」の 2 通りに読めた。
 *
 * ★★ 2026-08-23 に一度作り直している。初版は `req.on('close')` を「下流が閉じた時刻」として
 *   使っていたが、**それはリクエストを読み終えた時刻**だった (GET はボディが無いので即完了する)。
 *   実測で 3 本とも `client=+0.000s` になり、side が常に client と出た。
 *   → **下流が閉じた時刻は proxy からは測れない。測れないものを項目にしない。**
 *
 * ★★★ 代わりに、res が閉じた時点で分かることだけで組む:
 *   - 上流が閉じたか / いつか
 *   - res が最後まで書き切れたか (writableFinished)
 *   向きを決められないときは **unknown と書く**。沈黙にも、当てずっぽうにもしない。
 */
import { describeProxyClose } from '../../src/utils/ccStreamProxyLog.mts';

const base = { url: '/cc-queue/stream?project=support', startedAt: 1_000_000, bytes: 4096, resFinished: false };

describe('describeProxyClose — side の判定', () => {
  test('★ 上流が閉じたあと、1 秒以上あいて res が閉じたら side=upstream', () => {
    // 実測 2026-08-23: 上流が死んでから 59.78s 保持された 3 本がこの形
    const line = describeProxyClose({ ...base, now: 1_184_792, upstreamClosedAt: 1_125_009 });
    expect(line).toContain('side=upstream');
  });

  test('★ 上流が一度も閉じずに res が閉じたら side=client', () => {
    expect(describeProxyClose({ ...base, now: 1_050_000 })).toContain('side=client');
  });

  test('★ 1 秒未満で連鎖したら side=unknown (撤去のカスケードは向きを決められない)', () => {
    const line = describeProxyClose({ ...base, now: 1_050_400, upstreamClosedAt: 1_050_000 });
    expect(line).toContain('side=unknown');
  });

  test('★ ちょうど 1 秒は upstream 側に入れる (境界を決めておく)', () => {
    expect(describeProxyClose({ ...base, now: 1_051_000, upstreamClosedAt: 1_050_000 }))
      .toContain('side=upstream');
  });

  test('上流が res より後に閉じた記録でも unknown (負の差は信用しない)', () => {
    const line = describeProxyClose({ ...base, now: 1_050_000, upstreamClosedAt: 1_050_500 });
    expect(line).toContain('side=unknown');
  });

  test('★ error があっても side は上書きしない (ECONNRESET は両側に出る)', () => {
    const line = describeProxyClose({ ...base, now: 1_184_792, upstreamClosedAt: 1_125_009, error: 'read ECONNRESET' });
    expect(line).toContain('side=upstream');
    expect(line).toContain('err=read ECONNRESET');
  });
});

describe('describeProxyClose — 出す数値', () => {
  test('★ gap を出す (上流が閉じてから res が閉じるまで)', () => {
    // Mac 側が今日これを手で引き算した。3 本の幅 0.059s が 60 秒の天井の証拠になった
    expect(describeProxyClose({ ...base, now: 1_184_792, upstreamClosedAt: 1_125_009 }))
      .toContain('gap=59.783s');
  });

  test('上流が閉じていなければ gap は "-" (0.000 と区別する)', () => {
    expect(describeProxyClose({ ...base, now: 1_050_000 })).toContain('gap=-');
  });

  test('dur / upstream / bytes は初版と同じ書式のまま (今日の 3 本と比較可能に保つ)', () => {
    const line = describeProxyClose({ ...base, now: 1_184_792, upstreamClosedAt: 1_125_009, bytes: 132 });
    expect(line).toContain('dur=184.792s');
    expect(line).toContain('upstream=+125.009s');
    expect(line).toContain('bytes=132');
  });

  test('★ 壊れていた client= は出さない (測れないものを項目にしない)', () => {
    expect(describeProxyClose({ ...base, now: 1_184_792, upstreamClosedAt: 1_125_009 }))
      .not.toContain('client=');
  });

  test('res を書き切れたかを出す', () => {
    expect(describeProxyClose({ ...base, now: 1_050_000, resFinished: true })).toContain('res=finished');
    expect(describeProxyClose({ ...base, now: 1_050_000, resFinished: false })).toContain('res=aborted');
  });

  test('エラーが無ければ err=-', () => {
    expect(describeProxyClose({ ...base, now: 1_050_000 })).toContain('err=-');
  });

  test('行頭は固定 — 既存の grep を壊さないため', () => {
    expect(describeProxyClose({ ...base, now: 1_001_000 })).toMatch(/^\[cc-stream proxy\] closed: /);
  });

  test('バイト数 0 も出す (0 と「記録していない」を区別する)', () => {
    expect(describeProxyClose({ ...base, now: 1_001_000, bytes: 0 })).toContain('bytes=0');
  });
});

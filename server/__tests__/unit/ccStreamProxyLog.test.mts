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
import { describeProxyClose, endDownstream } from '../../src/utils/ccStreamProxyLog.mts';

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

/**
 * 上流が消えたときに下流も閉じる (#359、2026-08-23 の実測から)
 *
 * ★ 放っておくと 60 秒かかる。機構は docs/05 に揃っている:
 *   nginx (NAS) の `proxy_read_timeout` は 60s。ふだんは 15 秒ごとの heartbeat が
 *   それを抑えている (4 倍の余裕)。**heartbeat の発生源である agent-server が死ぬと
 *   抑えが外れる** —— proxy は気づかず、nginx が 60 秒で切るまで下流を抱え続ける。
 *
 * ★★ 実測: agent-server 再起動で 3 本とも 59.783 / 59.784 / 59.842 秒 保持された。
 *   その間クライアントは死んだ上流に繋がったままで、受信できない。
 *   同じ日の server 再起動 (proxy 自身が落ちる) は 1 秒で撤去され、空白は 19 秒だった。
 */
describe('endDownstream', () => {
  test('まだ書き終えていなければ閉じる', () => {
    const end = jest.fn();
    expect(endDownstream({ writableEnded: false, end })).toBe(true);
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('★ すでに書き終えていれば触らない (正常終了時に二重で end しない)', () => {
    const end = jest.fn();
    expect(endDownstream({ writableEnded: true, end })).toBe(false);
    expect(end).not.toHaveBeenCalled();
  });

  test('★ end が投げても呼び出し側に伝播させない (切断処理でクラッシュしない)', () => {
    const end = jest.fn(() => { throw new Error('already destroyed'); });
    expect(() => endDownstream({ writableEnded: false, end })).not.toThrow();
  });

  test('end が投げたときは false を返す (閉じられなかったと分かる)', () => {
    const end = jest.fn(() => { throw new Error('boom'); });
    expect(endDownstream({ writableEnded: false, end })).toBe(false);
  });
});

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
 * ★ ua —— 送り手を分ける鍵 (2026-09-02、Mac セッションからの依頼)
 *
 * ★ 背景: url に載るのは project だけで、probe-b / probe-c / 本線が全部 `tealus-dev`。
 *   **この行だけでは 3 本を分けられなかった**。ua があれば送り手で分かれる。
 *
 * ★★ ただし **`ua=-` は 1 本を指さない** (2026-09-02 07:05 に訂正が入った)。
 *   最初の申告は「probe は UA を送る / 本線は送らない → 本線は消去法で一意」だったが、
 *   実際に送っているのは **probe-c だけ**で、probe-b と本線はどちらも送っていない。
 *   probe-c だけを見た一般化だった。3 本に分かれるのは本線に `-A cc-main` が入った後。
 *   → **ここで固定するのは「値をどう書くか」だけ。「どの値がどの接続か」は固定しない**
 *     (送り手の構成は向こう側の都合で変わる。ここに書くと黙って古くなる)。
 *
 * ★★ 揃える側を選んだ理由: もう一案は「probe に -D を足して CF-Ray を取る」だったが、
 *   それは**実験装置そのものの変更**になる。こちらは受け身のログに 1 項目足すだけで、
 *   probe の張り方・切れ方は一切変わらない。**露出を触らない方を採った**。
 *
 * ★★★ UA はクライアントが自由に決める文字列なので、**そのまま書かない**。
 *   この行は空白区切りの key=value で、生の UA を通すと
 *   `side=upstream` のような**偽のフィールドを注入できてしまう** (改行なら行ごと偽造できる)。
 *   計器の値を読み手に偽らせないために、空白系は潰して長さも切る。
 */
describe('describeProxyClose — ua (送り手を分ける)', () => {
  test('★ UA があればそのまま載る (送っている接続はこれで一意)', () => {
    // ★ 実際にこの形で送っているのは probe-c のみ (2026-09-02 時点)
    expect(describeProxyClose({ ...base, now: 1_050_000, ua: 'cc-probe-c' })).toContain('ua=cc-probe-c');
  });

  test('★ UA が無ければ ua=- (誰が送っていないかは、この行では決めない)', () => {
    expect(describeProxyClose({ ...base, now: 1_050_000 })).toContain('ua=-');
  });

  test('★ 空文字も ua=- (空と「送っていない」を同じに倒す)', () => {
    expect(describeProxyClose({ ...base, now: 1_050_000, ua: '' })).toContain('ua=-');
  });

  test('★★★ 空白を潰す — 生で通すと偽のフィールドを注入できる', () => {
    const line = describeProxyClose({ ...base, now: 1_050_000, ua: 'evil side=upstream x' });
    expect(line).toContain('ua=evil_side_upstream_x');
    // ★ side は 1 か所しか出てはいけない (注入された側を数えないため)。
    //   空白を潰すだけでは文字列 `side=` が ua の中に残り、grep が 2 本に数えた
    expect(line.match(/side=/g)).toHaveLength(1);
    // ★★ 行の中の `=` はフィールド区切りだけ。ua の値に `=` を残さない
    expect(line.split(' ').filter((t) => t.startsWith('ua=')))
      .toEqual(['ua=evil_side_upstream_x']);
  });

  test('★★★ 改行も潰す — 行ごと偽造させない', () => {
    // ★ 改行そのものを渡す。エスケープを書くと、テスト側の書き間違いと区別できない
    const raw = ['a', '[cc-stream proxy] closed: url=fake'].join(String.fromCharCode(10));
    const line = describeProxyClose({ ...base, now: 1_050_000, ua: raw });
    expect(line).not.toContain(String.fromCharCode(10));
    expect(line.match(/\[cc-stream proxy\] closed: /g)).toHaveLength(1);
  });

  test('★ 長い UA は切り詰める (1 日 4 件の行が埋もれないように)', () => {
    const line = describeProxyClose({ ...base, now: 1_050_000, ua: 'x'.repeat(200) });
    const ua = /ua=(\S+)/.exec(line)?.[1] ?? '';
    expect(ua).not.toBe('');   // ★ ua= が無いと長さ検査は素通りする
    expect(ua.length).toBeLessThanOrEqual(64);
  });

  test('★ ua は err より前に置く (err は空白を含むので末尾のまま)', () => {
    const line = describeProxyClose({ ...base, now: 1_050_000, ua: 'cc-probe-c', error: 'read ECONNRESET' });
    expect(line).toContain('ua=cc-probe-c');   // ★ 先に存在を見る (-1 < n で素通りするため)
    expect(line.indexOf('ua=')).toBeLessThan(line.indexOf('err='));
    expect(line).toContain('err=read ECONNRESET');
  });

  test('既存フィールドの書式は変えない (8 月の行と比較可能に保つ)', () => {
    const line = describeProxyClose({ ...base, now: 1_184_792, upstreamClosedAt: 1_125_009, bytes: 132, ua: 'cc-probe-b' });
    expect(line).toMatch(/^\[cc-stream proxy\] closed: /);
    expect(line).toContain('dur=184.792s');
    expect(line).toContain('upstream=+125.009s');
    expect(line).toContain('gap=59.783s');
    expect(line).toContain('bytes=132');
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

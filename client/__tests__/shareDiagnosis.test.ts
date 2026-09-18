import { describe, it, expect } from 'vitest';
import { diagnoseShare, isEmptyMultipart, type ShareDiagnosisInput, type ShareRecord } from '../src/components/share/shareDiagnosis';

/**
 * #445 共有が失敗したときに **何が起きなかったか**を名指しする。
 *
 * ★ 2026-09-18、Mac セッションとの 4 往復で 4 つ穴が出た。★★ どれも建てる前に出ている:
 *   1 「SW の印が無い」が 3 通りの意味を持つ (a2 / SW 無効 / 別経路)
 *   2 **旧 SW が制御している**とき、controller を見るだけでは新旧を分けられない
 *   3 印を URL に置くと **再訪で残る** (履歴・再読み込み)
 *   4 ★ 既存の「取り出せませんでした」が、再訪で **空き容量を疑えと言う** (誤診)
 *
 * ★★★ だから判定は「記録の有無」を主にし、★ 行の順序も仕様として固定する。
 */

const rec = (over: Partial<ShareRecord> = {}): ShareRecord => ({
  fields: ['title', 'text', 'media'], mediaCount: 1, zeroSized: 0, sizes: [1234], t: 1000,
  contentType: 'multipart/form-data; boundary=x', bodyBytes: 2048, ...over,
});

const input = (over: Partial<ShareDiagnosisInput> = {}): ShareDiagnosisInput => ({
  record: null, controlled: true, swReplied: true, hasShareParams: false, launch: null, ...over,
});

describe('#445 共有の診断 — ★ 5 通りを名指しする', () => {
  it('★ 記録があれば「SW が動いた」。★★ 点呼が detail に出る', () => {
    const d = diagnoseShare(input({ record: rec({ mediaCount: 2, zeroSized: 1, sizes: [0, 900] }) }));
    expect(d.code).toBe('sw-handled');
    expect(d.detail).toContain('media');
    expect(d.detail).toContain('2');
    expect(d.detail).toContain('0 バイト');
  });

  it('★ controller が無ければ「SW が効いていない」', () => {
    expect(diagnoseShare(input({ controlled: false })).code).toBe('sw-absent');
  });

  it('★★★★ 返事が無ければ「旧 SW が制御している」 (★ 旧版は message listener を持たない)', () => {
    expect(diagnoseShare(input({ swReplied: false })).code).toBe('sw-stale');
  });

  it('★ 記録が無く、URL にパラメータだけ残っていれば「再訪」', () => {
    expect(diagnoseShare(input({ hasShareParams: true })).code).toBe('revisit');
  });

  it('★ どれでもなければ「POST が起きていない」', () => {
    expect(diagnoseShare(input()).code).toBe('no-post');
  });
});

describe('#445 ★★★★ 行の順序は仕様 —— ★ 並べ替えで静かに変わらないよう固定する', () => {
  // ★ Mac セッションの指摘: 5 行は排他ではない。同時に真になれる組がある
  it('★ 記録があれば、他が何であれ「SW が動いた」が勝つ', () => {
    const d = diagnoseShare(input({ record: rec(), controlled: false, swReplied: false, hasShareParams: true }));
    expect(d.code).toBe('sw-handled');
  });

  it('★★ SW 無効 と 再訪 が同時に真なら → ★★★ SW 無効 (★ 利用者に打てる手がある方)', () => {
    const d = diagnoseShare(input({ controlled: false, hasShareParams: true }));
    expect(d.code).toBe('sw-absent');
  });

  it('★★★★ 旧 SW と 再訪 が同時に真なら → ★ 旧 SW', () => {
    // ★ 旧 SW は live な共有でも files=N を付ける = hasShareParams が真になる。
    //   ★★ ここで「再訪」を先に返すと、**生きている共有の失敗を再訪と誤診する**
    const d = diagnoseShare(input({ swReplied: false, hasShareParams: true }));
    expect(d.code).toBe('sw-stale');
  });

  it('★ SW 無効 は 旧 SW より先 (★★ controller が無ければ 返事が無いのは当然)', () => {
    const d = diagnoseShare(input({ controlled: false, swReplied: false }));
    expect(d.code).toBe('sw-absent');
  });
});

describe('#445 ★★★★ 昨日の誤診を出さない —— ★ 再訪で「空き容量」と言わない', () => {
  it('★ 再訪のとき、文面に「空き容量」を含めない', () => {
    const d = diagnoseShare(input({ hasShareParams: true }));
    expect(d.message).not.toContain('空き容量');
    expect(d.message).toContain('再');
  });

  it('★★ 空き容量を疑ってよいのは「SW が動いて 0 バイトで届いた」ときだけ', () => {
    const d = diagnoseShare(input({ record: rec({ mediaCount: 1, zeroSized: 1, sizes: [0] }) }));
    expect(d.message).toContain('空き容量');
  });

  it('★★★ media が 1 件も来ていないなら 空き容量の話ではない (★ 受け渡しの段)', () => {
    const d = diagnoseShare(input({ record: rec({ fields: ['title', 'text'], mediaCount: 0, zeroSized: 0, sizes: [] }) }));
    expect(d.message).not.toContain('空き容量');
    expect(d.detail).toContain('media');
  });
});

/**
 * ★★★★ 2026-09-18 第 2 版: launchQueue の状態も点呼に出す。
 *
 * ★ Chrome 153 は POST 本体を **空**で寄越す (実測 `field: []`)。★★ `LaunchParams.files` が
 *   もう 1 本の受け口かもしれない —— ★★★ **当たっても外れても、次の 1 枚で確定する**ように
 *   「見ていない / 非対応 / 0 件 / N 件」の 4 つを書き分ける。
 */
describe('#445 ★ launchQueue の状態を点呼に出す', () => {
  it('★ 見ていなければ「見ていない」と書く (★★ 「非対応」と混ぜない)', () => {
    expect(diagnoseShare(input({ launch: null })).detail).toContain('見ていません');
  });

  it('★ 非対応なら「非対応」(★★ 0 件と言わない)', () => {
    const d = diagnoseShare(input({ launch: { checked: true, supported: false, fileCount: 0 } }));
    expect(d.detail).toContain('非対応');
    expect(d.detail).not.toContain('0 件');
  });

  it('★★ 対応していて 0 件なら、そう書く', () => {
    const d = diagnoseShare(input({ launch: { checked: true, supported: true, fileCount: 0 } }));
    expect(d.detail).toContain('launchQueue');
    expect(d.detail).toContain('0 件');
  });

  it('★★★★ N 件来ていたら件数を出す (★ ここに数字が出たら 受け口はこちらだった)', () => {
    const d = diagnoseShare(input({ launch: { checked: true, supported: true, fileCount: 2 } }));
    expect(d.detail).toContain('2 件');
  });

  it('★ launch の欄は 判定 (code) を変えない (★★ 点呼にだけ出る)', () => {
    const base = input({ hasShareParams: true });
    expect(diagnoseShare(base).code).toBe('revisit');
    expect(diagnoseShare({ ...base, launch: { checked: true, supported: true, fileCount: 3 } }).code).toBe('revisit');
  });
});

/**
 * ★★★★★ 2026-09-18 第 3 版: **本文にバイトがあるか**を出す。
 *
 * ★ `formData()` が空を返したのは「0 件」であって、★★ **本文が空であることの証明ではない**。
 *   ★★★ バイトがあるのに解釈できていないなら、直すのは **こちら側**。
 * ★★★★ 「0 件が出たら まず器を疑う」を、★ Chromium に上げる前にもう一度やる。
 */
describe('#445 ★★★★ 本文のバイト数と content-type を点呼に出す', () => {
  it('★ 本文が 0 バイトなら そう書く (★★ 送り手が空を寄越したことの証拠になる)', () => {
    const d = diagnoseShare(input({ record: rec({ fields: [], mediaCount: 0, sizes: [], bodyBytes: 0 }) }));
    expect(d.detail).toContain('本文 0 バイト');
  });

  it('★★★★ 本文にバイトがあるのに field が空なら、★ 「解釈できていない」と分かる形で出す', () => {
    const d = diagnoseShare(input({ record: rec({ fields: [], mediaCount: 0, sizes: [], bodyBytes: 51234 }) }));
    expect(d.detail).toContain('51234');
    // ★ ここが出たら 犯人は Chrome ではなく こちらの読み取り側
    expect(d.detail).toContain('解釈できていません');
  });

  it('★ 測れなかったときは -1 を そのまま出さない (★★ 「測れず」と書く)', () => {
    const d = diagnoseShare(input({ record: rec({ bodyBytes: -1 }) }));
    expect(d.detail).toContain('本文: 測れず');
    expect(d.detail).not.toContain('-1');
  });

  it('★ content-type を そのまま出す (★★ 送り手が何と名乗ったか)', () => {
    const d = diagnoseShare(input({ record: rec({ contentType: 'text/plain' }) }));
    expect(d.detail).toContain('text/plain');
  });

  it('★★ field が空でなければ「解釈できていません」は出さない', () => {
    const d = diagnoseShare(input({ record: rec({ fields: ['title'], mediaCount: 0, sizes: [], bodyBytes: 900 }) }));
    expect(d.detail).not.toContain('解釈できていません');
  });
});

/**
 * ★★★★★ 2026-09-18 第 4 版: 「中身ゼロの multipart」を **名指しする**。
 *
 * ★ 実測 (Chrome 153):
 * ```
 * type: multipart/form-data; boundary=----MultipartBoundary--M3JeXv…JdL----   (★ boundary 69 字)
 * 本文 75 バイト  = ★★ '--' + boundary + '--' + CRLF = 69 + 6   ← ★★★★ 差 0
 * ```
 * → ★ 本文は **終端区切りだけ**。★★ パートが 1 つも無い = `formData()` の 0 件は **正しい読み**。
 *
 * ★★★ だから前版の「本文はあるのに解釈できていません」は **言い方が誤り**だった。
 *   ★ 解釈はできていて、中身が無いのが正しい。★★ ここを直す。
 */
const CT = (b: string) => `multipart/form-data; boundary=${b}`;
const B69 = '----MultipartBoundary--M3JeXvGeZvoZoqCOKRcIDg8kN1s887DFnzYGHzfJdL----';

describe('#445 ★★★★ 中身ゼロの multipart を名指しする', () => {
  it('★ boundary から期待値を計算して突き合わせる (★★ 75 という数字を焼き込まない)', () => {
    expect(isEmptyMultipart(CT(B69), B69.length + 6)).toBe(true);
    expect(isEmptyMultipart(CT(B69), B69.length + 7)).toBe(false);
    expect(isEmptyMultipart(CT(B69), 0)).toBe(false);
  });

  it('★ boundary が引用符つきでも読む', () => {
    expect(isEmptyMultipart(`multipart/form-data; boundary="${B69}"`, B69.length + 6)).toBe(true);
  });

  it('★ boundary が無ければ判定しない (★★ 憶測で true にしない)', () => {
    expect(isEmptyMultipart('multipart/form-data', 75)).toBe(false);
    expect(isEmptyMultipart('text/plain', 75)).toBe(false);
  });

  it('★★★★ 中身ゼロと分かったら「解釈できていません」ではなく「パート 0 件」と書く', () => {
    const d = diagnoseShare(input({
      record: rec({ fields: [], mediaCount: 0, sizes: [], contentType: CT(B69), bodyBytes: B69.length + 6 }),
    }));
    expect(d.detail).toContain('パート 0 件');
    expect(d.detail).not.toContain('解釈できていません');
  });

  it('★★★★★ 利用者には ＋ボタン を案内する (★ 行き止まりで止めない)', () => {
    const d = diagnoseShare(input({
      record: rec({ fields: [], mediaCount: 0, sizes: [], contentType: CT(B69), bodyBytes: B69.length + 6 }),
    }));
    expect(d.message).toContain('ボタン');
    expect(d.code).toBe('sw-handled');
  });

  it('★ 期待値より大きい本文なら、従来どおり「解釈できていません」', () => {
    const d = diagnoseShare(input({
      record: rec({ fields: [], mediaCount: 0, sizes: [], contentType: CT(B69), bodyBytes: 51234 }),
    }));
    expect(d.detail).toContain('解釈できていません');
    expect(d.detail).not.toContain('パート 0 件');
  });
});

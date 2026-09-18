import { describe, it, expect } from 'vitest';
import { diagnoseShare, type ShareDiagnosisInput, type ShareRecord } from '../src/components/share/shareDiagnosis';

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
  fields: ['title', 'text', 'media'], mediaCount: 1, zeroSized: 0, sizes: [1234], t: 1000, ...over,
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

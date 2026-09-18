/**
 * #442 doctor 第 2 版 — 実測する口。
 *
 * ★ 第 1 版 (#438) は **設定を見るだけ**だった。この版で足すのは「実際に引いて確かめる」側:
 *
 *   1 DB migration の適用状態   … ★ `planMigrations` を作り直さずに使う
 *   2 本線 (cc-main) の生死      … ★ 見張りを立て直さず、proxy ログの 1 欄で読む (2026-09-15 の判断)
 *   3 辞書オーバーレイの掛け違い  … ★ DB を直したのに在庫の語彙が古いまま、を黙らせない (#384)
 *   4 外部疎通                   … ★ 別の口 (--probe)。既定では叩かない
 *
 * ★★ 守る約束は第 1 版から継ぐ (止めない / 何を設定すればよいかを出す / 実測した範囲しか言わない /
 *   値を出さない)。★★★ この版で足す約束が 1 つ:
 *
 *   ★ **「叩けなかった」と「叩かなかった」を区別する。** 「疎通 0 件」が
 *     「確かめて全部だめ」なのか「そもそも叩いていない」なのか読めないと、沈黙と同じになる。
 */
import {
  judgeMigrations,
  judgeMainline,
  judgeOverlayDrift,
  judgeProbe,
  lastMainlineCloseAt,
  type Finding,
  type ProbeResult,
} from '../../src/lib/doctor.mts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const text = (f: Finding): string => `${f.detail}\n${f.fix}`;

describe('#442 (1) DB migration の適用状態', () => {
  it('未適用があれば warn。★ ファイル名を出す', () => {
    const f = judgeMigrations(['028_x.sql', '029_y.sql'], 27);
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('028_x.sql');
    expect(f.detail).toContain('029_y.sql');
    // ★ 約束 2: 何をすればよいか
    expect(f.fix).toContain('npm run migrate');
  });

  it('未適用ゼロなら info。★ ただし「全部 OK」とは言わず、適用済みの件数を出す', () => {
    const f = judgeMigrations([], 27);
    expect(f.level).toBe('info');
    expect(f.detail).toContain('27');
    expect(f.detail).not.toContain('全部 OK');
  });

  it('★ 引けなかったときは「0 件」と言わない (沈黙と区別する)', () => {
    const f = judgeMigrations(null, null);
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('引けませんでした');
    // ★ 「0 件」を**明示的に否定する**こと。★★ 単に書かないだけだと、読み手が 0 と埋めてしまう
    expect(f.detail).toContain('「未適用 0 件」ではありません');
  });
});

describe('#442 (2) 本線 (cc-main) の生死', () => {
  it('★ 2 時間を超えて close が無ければ warn', () => {
    const f = judgeMainline(185, 120);
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('185');
  });

  it('2 時間以内なら info', () => {
    const f = judgeMainline(55, 120);
    expect(f.level).toBe('info');
  });

  it('★★ 1 度も見つからなければ warn。★ 「異常なし」と読めてはいけない', () => {
    const f = judgeMainline(null, 120);
    expect(f.level).toBe('warn');
    expect(text(f)).toContain('見つかりませんでした');
    // ★ 見張りが 19 日死んでいたのに沈黙が「異常なし」に見えた形 (2026-09-15) を繰り返さない
    expect(text(f)).not.toContain('正常');
  });

  it('★★★ ログから最後の cc-main の close 時刻を拾う (新しいファイルから遡る)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-log-'));
    fs.writeFileSync(
      path.join(dir, 'tealus-server-2026-09-14.log'),
      '2026-09-14 10:00:00.000 [info] [cc-stream proxy] closed: url=/x ua=cc-main cf=NRT err=-\n'
    );
    fs.writeFileSync(
      path.join(dir, 'tealus-server-2026-09-15.log'),
      [
        '2026-09-15 11:24:10.517 [info] [cc-stream proxy] closed: url=/x ua=cc-main cf=NRT err=-',
        // ★ 本線でないものは拾わない (probe / 他の購読者)
        '2026-09-15 12:00:00.000 [info] [cc-stream proxy] closed: url=/x ua=cc-probe-c cf=NRT err=-',
        '2026-09-15 13:14:29.966 [info] [cc-stream proxy] closed: url=/x ua=cc-main cf=NRT err=-',
      ].join('\n') + '\n'
    );
    const at = lastMainlineCloseAt(dir);
    expect(at).not.toBeNull();
    expect(at!.getFullYear()).toBe(2026);
    expect(at!.getMonth()).toBe(8); // 9 月
    expect(at!.getDate()).toBe(15);
    expect(at!.getHours()).toBe(13);
    expect(at!.getMinutes()).toBe(14);
  });

  it('★ ログが 1 つも無ければ null (例外にしない)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-log-empty-'));
    expect(lastMainlineCloseAt(dir)).toBeNull();
    expect(lastMainlineCloseAt(path.join(dir, 'no-such-dir'))).toBeNull();
  });
});

describe('#442 (3) 辞書オーバーレイの掛け違い (#384)', () => {
  it('★ DB と在庫の語彙がずれていたら warn。★★ 「どちらが新しいか」まで書く', () => {
    const f = judgeOverlayDrift({ dbTerms: 257, overlayTerms: 259, dbAliases: 700, overlayAliases: 700 });
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('257');
    expect(f.detail).toContain('259');
    // ★ 2026-09-15 に手で埋めた手順がそのまま出ること
    expect(f.fix).toContain('reload-vocab');
  });

  it('一致していれば info', () => {
    const f = judgeOverlayDrift({ dbTerms: 299, overlayTerms: 299, dbAliases: 700, overlayAliases: 700 });
    expect(f.level).toBe('info');
  });

  it('★ どちらかが引けなければ warn。★★ 「ずれ 0」と言わない', () => {
    const base = { dbAliases: 700, overlayAliases: 700 };
    expect(judgeOverlayDrift({ ...base, dbTerms: null, overlayTerms: 299 }).level).toBe('warn');
    expect(judgeOverlayDrift({ ...base, dbTerms: 299, overlayTerms: null }).level).toBe('warn');
    expect(judgeOverlayDrift({ ...base, dbTerms: null, overlayTerms: null }).detail).not.toContain('一致');
  });

  // ★ 2026-09-18 実地: 語は 303 = 303 のまま、別名だけを 1 行 動かした。
  //   ★★ 語しか見ていなかった当時の口は「ずれ 0」と答える = 掛け違いを 1 件も検知できない。
  it('★★★ 語の件数が一致していても、別名がずれていたら warn', () => {
    const f = judgeOverlayDrift({ dbTerms: 303, overlayTerms: 303, dbAliases: 758, overlayAliases: 757 });
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('758');
    expect(f.detail).toContain('757');
    expect(f.detail).toContain('別名');
    expect(f.fix).toContain('reload-vocab');
  });

  it('★ 語も別名も一致して初めて info', () => {
    expect(judgeOverlayDrift({ dbTerms: 303, overlayTerms: 303, dbAliases: 758, overlayAliases: 758 }).level).toBe('info');
  });

  it('★★ 別名を引けなければ warn。★★★ 語が一致していても「ずれ 0」と言わない', () => {
    const f = judgeOverlayDrift({ dbTerms: 303, overlayTerms: 303, dbAliases: null, overlayAliases: 758 });
    expect(f.level).toBe('warn');
    expect(f.detail).not.toContain('ずれ 0');
  });

  // ★ 渡し忘れを 0 件と読まない (★★ 省略できる引数は「妥当に見える嘘」を返す)
  it('★★★★ 別名の件数を渡し忘れたら warn。★ 0 件と読まない', () => {
    const f = judgeOverlayDrift({ dbTerms: 303, overlayTerms: 303 } as never);
    expect(f.level).toBe('warn');
    expect(f.detail).not.toContain('0 件');
  });
});

describe('#442 (4) 外部疎通 — ★ 3 値で出る', () => {
  const R = (over: Partial<ProbeResult>): ProbeResult =>
    ({ route: 'Light', model: 'gpt-5.5', via: 'codex(subscription)', status: 'not-probed', note: '' , ...over });

  it('★ 成功 / 失敗 / 叩かなかった が 3 つとも読める', () => {
    const f = judgeProbe([
      R({ route: 'Router', model: 'gpt-4o-mini', via: 'OpenAI API', status: 'ok', note: '鍵で一覧に在り' }),
      R({ route: 'Deep', model: 'gpt-9-nope', via: 'OpenAI API', status: 'failed', note: '鍵の一覧に無い' }),
      R({ route: 'Light', status: 'not-probed', note: 'codex subscription 経由なので API 鍵では確かめられない' }),
    ]);
    expect(f.detail).toContain('ok');
    expect(f.detail).toContain('failed');
    expect(f.detail).toContain('not-probed');
    // ★ どの鍵でどの経路を叩いたかを並記する (#442 の「何を比べてよいか まで書く」)
    expect(f.detail).toContain('OpenAI API');
    expect(f.detail).toContain('codex(subscription)');
  });

  it('★★ 表に無いモデルでも、叩けば failed として出る (第 1 版の表照合では捕まえられない側)', () => {
    const f = judgeProbe([R({ route: 'Deep', model: 'gpt-9-nope', via: 'OpenAI API', status: 'failed', note: '鍵の一覧に無い' })]);
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('gpt-9-nope');
  });

  it('★★★ 1 件も叩かなかったときに「全部だめ」と読めない', () => {
    const f = judgeProbe([R({ status: 'not-probed' })]);
    expect(f.level).toBe('info');
    expect(text(f)).toContain('叩いていません');
  });

  it('★ 失敗が無くても「全部 OK」と言わない', () => {
    const f = judgeProbe([R({ route: 'Router', via: 'OpenAI API', status: 'ok' })]);
    expect(text(f)).not.toContain('全部 OK');
  });
});

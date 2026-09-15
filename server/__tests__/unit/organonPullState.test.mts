/**
 * #384 organon の pull 状態を「引ける口」として外へ出す。
 *
 * ★ なぜ通知だけでは足りないか (organon 班の指摘、2026-09-14)
 *   停止時だけ 1 行 出す形にすると、**沈黙が 2 つの意味を持つ**:
 *     (1) pull は動いていて異常が無い
 *     (2) ★ 通知の仕組み自体が止まっている
 *   向こうは `listen-tealus` skill で一度これに焼かれている。日次 1 行を足しても
 *   「来るはずのものが来ない」と誰かが気づいて初めて機能する = 見る人がいないと同じ。
 *
 * ★★ なので通知ではなく **口**を置く。向こうは毎日 Step 5 を回すので、そこで 1 回引けばよい。
 *   「送る側が通知してくれること」を前提にした監視は監視でない —— 今日こちらが
 *   「歯止めは受け取る側に置く」と言ったことの、素直な適用。
 *
 * ★★★ 置き場所は **どちらの repo でもない**ところ。organon の作業ツリーに書くと
 *   誤って commit されうるし、tealus の中だと向こうから見つけにくい。
 */
import path from 'node:path';
import os from 'node:os';
import { buildPullState, pullStatePath } from '../../src/services/organonPullState.mts';

describe('pullStatePath', () => {
  const orig = process.env.ORGANON_PULL_STATE_PATH;
  afterEach(() => {
    if (orig === undefined) delete process.env.ORGANON_PULL_STATE_PATH;
    else process.env.ORGANON_PULL_STATE_PATH = orig;
  });

  it('既定は ~/.tealus/ の下 (どちらの repo でもない場所)', () => {
    delete process.env.ORGANON_PULL_STATE_PATH;
    expect(pullStatePath()).toBe(
      path.join(os.homedir(), '.tealus', 'organon-pull-state.json'),
    );
  });

  it('env で差し替えられる', () => {
    process.env.ORGANON_PULL_STATE_PATH = 'D:/somewhere/state.json';
    expect(pullStatePath()).toBe('D:/somewhere/state.json');
  });
});

describe('buildPullState', () => {
  const ranAt = new Date('2026-09-14T06:20:00Z');

  it('引く側が判断できる項目を持つ', () => {
    const s = buildPullState({ ranAt, terms: 257, aliases: 608, ttlPath: 'C:/x/organon.ttl' });
    expect(s.last_pull_at).toBe('2026-09-14T06:20:00.000Z');
    expect(s.terms).toBe(257);
    expect(s.aliases).toBe(608);
    expect(s.ttl_path).toBe('C:/x/organon.ttl');
  });

  it('★ 何を意味する file かを file 自身に書く', () => {
    // ★ 後から開く人が、それが「最後に成功した pull」なのか「最後に試した pull」なのかを
    //   判断できないと、止まっているのか動いているのか読み違える。
    const s = buildPullState({ ranAt, terms: 1, aliases: 2, ttlPath: 'x' });
    expect(s.note).toContain('成功した pull');
  });

  it('★★ 失敗した pull では呼ばれない前提を、値で表さない', () => {
    // 「成功したときだけ書く」を守るのは呼び出し側。ここに ok:true のような欄を置くと
    // 「false もありうる」と読まれ、引く側が分岐を書いてしまう。
    const s = buildPullState({ ranAt, terms: 1, aliases: 2, ttlPath: 'x' });
    expect(Object.keys(s)).not.toContain('ok');
    expect(Object.keys(s)).not.toContain('success');
  });
});

/**
 * ★ 2026-09-15 追加 — organon 班の要望「pull の外で DB が動いたことが、口から見えるように」。
 *
 * ★★ 素直に「DB の active 数」を足すだけだと **向こうからは判断できない** ——
 *   向こうは DB を引けないので、数字が 1 つ増えても比べる相手がいない。
 * ★★★ なので **1 file だけで読める不変条件**の形にする:
 *
 *     pull 直後なら  射影の terms  ==  DB の organon 由来 active 語数
 *
 *   ずれていれば「撤去が届いていない」か「pull の外で誰かが触った」のどちらか。
 *   ★★★★ 実際、今日 (2026-09-15) の撤去前は 射影 257 / DB 259 だった。
 *   **この欄があれば #384 の積み残しは毎日見えていた。**
 */
describe('buildPullState — ★ 掛け違いが 1 file で読める形 (2026-09-15)', () => {
  const ranAt = new Date('2026-09-15T04:35:45Z');

  it('★ DB の organon 由来 active 語数を持つ', () => {
    const s = buildPullState({
      ranAt, terms: 258, aliases: 609, ttlPath: 'x', dbOrganonActiveTerms: 258,
    });
    expect(s.db_organon_active_terms).toBe(258);
  });

  it('★★ 一致していれば drift は 0', () => {
    const s = buildPullState({
      ranAt, terms: 258, aliases: 609, ttlPath: 'x', dbOrganonActiveTerms: 258,
    });
    expect(s.drift).toBe(0);
  });

  it('★★★ 撤去が届いていない状態が 正の drift として出る (今日の撤去前の実値)', () => {
    const s = buildPullState({
      ranAt, terms: 257, aliases: 608, ttlPath: 'x', dbOrganonActiveTerms: 259,
    });
    expect(s.drift).toBe(2);
    // ★ 引く側が「どちらが多いのか」を自分で計算しなくてよい形にする
    expect(s.note).toContain('drift');
  });

  it('★ 引けなかったときは 0 と書かない (沈黙と区別する)', () => {
    const s = buildPullState({ ranAt, terms: 258, aliases: 609, ttlPath: 'x' });
    expect(s.db_organon_active_terms).toBeNull();
    expect(s.drift).toBeNull();
  });

  it('★★ 既存の欄は変わらない (向こうが既に読んでいる)', () => {
    const s = buildPullState({
      ranAt, terms: 258, aliases: 609, ttlPath: 'C:/x/organon.ttl', dbOrganonActiveTerms: 258,
    });
    expect(s.last_pull_at).toBe('2026-09-15T04:35:45.000Z');
    expect(s.terms).toBe(258);
    expect(s.aliases).toBe(609);
    expect(s.ttl_path).toBe('C:/x/organon.ttl');
    expect(s.note).toContain('成功した pull');
  });
});

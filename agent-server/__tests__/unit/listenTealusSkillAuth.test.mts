import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * #427 cc-bridge が 55 分ごとに `POST /api/auth/login` を平文の資格情報で叩くのをやめる。
 *
 * ★ **なぜ SKILL の sh をテストできる形にしたか**: この loop は
 *   `.claude/skills/listen-tealus/SKILL.md` の「削らないこと」表つきで配布されており、
 *   **各自が curl で取る**ので追随しない環境が残る。★★ 壊すと「セッションが黙って聞かなくなる」——
 *   失敗が無音なので、テストが無いまま触る場所ではない。
 *
 * ★★★ テストは**配布されている文面そのもの**を読んで実行する (写しを作らない)。
 *   写しを置くと、SKILL.md を直したときにテストだけ古い文面を守る側に回る。
 *
 * ★ 測ったこと (2026-09-11): 本体ログの `login: success` は 1 日 約 150 件で、
 *   うち **83 件 (55%) が bridge の口** (3 接続 × 26 回 + 想定外切断ぶん)。
 *   bcrypt cost10 は 約 51ms なので CPU は **4.2 秒/日** —— ★★ 動機① は実在するが小さい。
 *   **効くのは動機②** (平文の資格情報を 1 日 83 回 送る) の方で、これを 約 1/180 にする。
 *
 * ★★ 認可の取り直し (#360 の目的) は**トークンを使い回しても果たされる**:
 *   `agent-server/src/routes/ccQueue.mts` の `resolveAllowedRooms` が**接続ごとに**
 *   `/api/rooms` を引き、本体の `authenticate` が**リクエストごとに** `is_active` を見る。
 *   → 認可は JWT に入っていないので、login し直す必要が無い。
 */

const SKILL = path.resolve(process.cwd(), '..', '.claude', 'skills', 'listen-tealus', 'SKILL.md');

/** SKILL.md から接続コマンドの sh block を取り出す */
function readLoopBlock(): string {
  const md = fs.readFileSync(SKILL, 'utf8');
  const blocks = md.split('```');
  const sh = blocks.find((b) => b.startsWith('sh') && b.includes('while true; do'));
  if (!sh) throw new Error('SKILL.md に while true の sh block が見つかりません');
  return sh.replace(/^sh\n/, '');
}

/**
 * ★ loop に入る前の部分 (= 変数と関数の定義) だけを取り出す。
 *   ここに認証の判断を関数として置いてあるので、**loop を回さずに 1 回だけ呼べる**。
 */
function readPrologue(): string {
  const block = readLoopBlock();
  const at = block.indexOf('while true; do');
  if (at < 0) throw new Error('while true; do が見つかりません');
  return block.slice(0, at);
}

interface RunResult { token: string; code: string; logins: number; pendings: number; out: string }

/**
 * 配布文面の prologue を読み込み、`auth_prepare` を 1 回呼ぶ。
 * curl は stub に差し替える (★ ネットワークには出ない)。
 * @param pendingCodes stub が /pending で返す HTTP status を、呼ばれた順に使う
 */
function runAuthPrepare(opts: { pendingCodes: string[]; tokenSeed?: string; maxAgeMs?: number }): RunResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auth-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ login_id: 'STUB', password: 'stub-pw' }));
  fs.writeFileSync(path.join(dir, 'pending-codes'), opts.pendingCodes.join('\n') + '\n');

  // ★ curl の stub。login と /pending を区別し、呼ばれた回数を数える。
  //   ★★ -w '\n%{http_code}' を使う実装を想定して、本文の次の行に status を出す。
  const stub = [
    '#!/bin/sh',
    `DIR='${dir.replace(/\\/g, '/')}'`,
    'for a in "$@"; do case "$a" in *api/auth/login*) IS_LOGIN=1 ;; *pending*) IS_PENDING=1 ;; esac; done',
    'if [ "$IS_LOGIN" = "1" ]; then',
    '  echo x >> "$DIR/logins"',
    `  printf '{"token":"tok-%s"}' "$(wc -l < "$DIR/logins" | tr -d ' ')"`,
    '  exit 0',
    'fi',
    'if [ "$IS_PENDING" = "1" ]; then',
    '  echo x >> "$DIR/pendings"',
    '  N=$(wc -l < "$DIR/pendings" | tr -d " ")',
    '  CODE=$(sed -n "${N}p" "$DIR/pending-codes"); [ -n "$CODE" ] || CODE=200',
    '  if [ "$CODE" = "200" ]; then',
    `    printf '{"max_age_ms":${opts.maxAgeMs ?? 3300000}}\\n%s' "$CODE"`,
    '  else',
    `    printf '{"error":"stub"}\\n%s' "$CODE"`,
    '  fi',
    '  exit 0',
    'fi',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(bin, 'curl'), stub, { mode: 0o755 });

  const prologue = readPrologue()
    .replace('{project_name}', 'stubproj')
    .replace('{本体の origin}', 'http://stub.invalid')
    .replace('{stream_url}', 'http://stub.invalid/agent-api/cc-queue')
    .replace('{auth_file}', path.join(dir, 'auth.json').replace(/\\/g, '/'));

  const seed = opts.tokenSeed === undefined ? '' : `TOKEN='${opts.tokenSeed}'; `;
  const script = `${prologue}\n${seed}auth_prepare\nprintf 'RESULT token=%s code=%s\\n' "$TOKEN" "$CODE"\n`;
  const out = execFileSync('sh', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  const m = out.match(/RESULT token=(\S*) code=(\S*)/);
  const count = (f: string) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).length : 0);
  return { token: m?.[1] ?? '', code: m?.[2] ?? '', logins: count('logins'), pendings: count('pendings'), out };
}

describe('listen-tealus SKILL の認証 — 55 分ごとの login をやめる (#427)', () => {
  it('★ 配布文面に、loop の外で TOKEN を空に初期化する行がある', () => {
    expect(readPrologue()).toMatch(/(^|;|\s)TOKEN=(\s|$|;)/m);
  });

  it('★★ loop の中で無条件に login していない (これが #427 の本体)', () => {
    const block = readLoopBlock();
    const body = block.slice(block.indexOf('while true; do'));
    // ★ loop 本文に login の URL が直接現れないこと (呼ぶのは関数経由で、条件つき)
    expect(body).not.toMatch(/api\/auth\/login/);
  });

  it('★ トークンが無ければ取得する (初回)', () => {
    const r = runAuthPrepare({ pendingCodes: ['200'] });
    expect(r.logins).toBe(1);
    expect(r.token).toBe('tok-1');
    expect(r.code).toBe('200');
  });

  it('★★★ トークンが有効なら login を呼ばない (= 55 分ごとの bcrypt が消える)', () => {
    const r = runAuthPrepare({ pendingCodes: ['200'], tokenSeed: 'tok-old' });
    expect(r.logins).toBe(0);
    expect(r.token).toBe('tok-old');
    expect(r.pendings).toBe(1);
  });

  it('★★★ 401 なら取り直して、新しいトークンで続行する', () => {
    const r = runAuthPrepare({ pendingCodes: ['401', '200'], tokenSeed: 'tok-stale' });
    expect(r.logins).toBe(1);
    expect(r.token).toBe('tok-1');
    expect(r.code).toBe('200');
    expect(r.pendings).toBe(2);
  });

  it('★★★★ 取り直しても 401 なら、そこで止める (★ 速い再接続ループに入らない)', () => {
    const r = runAuthPrepare({ pendingCodes: ['401', '401'], tokenSeed: 'tok-stale' });
    expect(r.logins).toBe(1);      // ★ 1 回だけ。繰り返さない
    expect(r.pendings).toBe(2);    // ★ 2 回だけ。繰り返さない
    expect(r.code).toBe('401');    // ★ 呼び出し側が状態を読める
  });

  it('★★ 古いサーバ (max_age を返さない) でも落ちない — 401 ではないので取り直さない', () => {
    const r = runAuthPrepare({ pendingCodes: ['404'], tokenSeed: 'tok-old' });
    expect(r.logins).toBe(0);
    expect(r.code).toBe('404');
  });

  it('★ /pending の本文は 200 のとき max_age を読める形で残る (status 行と混ざらない)', () => {
    const r = runAuthPrepare({ pendingCodes: ['200'], maxAgeMs: 1234000 });
    expect(r.out).toContain('code=200');
    // ★ 本文の取り出しは prologue の中で行われる。ここでは status が token 側に混ざらないことを見る
    expect(r.token).toBe('tok-1');
  });
});

/**
 * #484 接続コマンドを SKILL.md から独立したスクリプト (cc-stream.sh) にも置いた。
 * ★ PaneDeck の service で常駐させるため (Monitor の 30 分の期限が消える)。
 * ★★ SKILL.md を 1 ファイルだけ curl で取っている別マシンがあるので、当面は 2 か所に置く。
 *   **食い違ったら落とす** (片方だけ直すと、もう片方が黙って古いまま配られる)。
 */
const SCRIPT = path.resolve(process.cwd(), '..', '.claude', 'skills', 'listen-tealus', 'cc-stream.sh');
const MARK = '# ---- ここから SKILL.md と同じ ----\n';

function readScript(): string {
  return fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n');
}

describe('cc-stream.sh — 接続コマンドのスクリプト (#484)', () => {
  it('★★★ 「SKILL.md と同じ」から後が、SKILL.md の接続コマンドと 1 文字も違わない', () => {
    const s = readScript();
    const at = s.indexOf(MARK);
    expect(at).toBeGreaterThan(0);
    // スクリプトは設定値を引数で受ける。SKILL.md は {…} を置き換える。その 2 か所だけを戻して比べる
    const back = 'P={project_name}; API={本体の origin}; STREAM={stream_url}\n'
      + s.slice(at + MARK.length).replace('-d @"$AUTH"', '-d @{auth_file}');
    // ★ SKILL.md は CRLF のことがあり、readLoopBlock の `^sh\n` が外れない。改行をそろえてから外す
    expect(back).toBe(readLoopBlock().replace(/\r\n/g, '\n').replace(/^sh\n/, ''));
  });

  it('★★ 構文が通る / わざと壊すと落ちる (検査が何かを見ていることを確かめる)', () => {
    expect(() => execFileSync('sh', ['-n', SCRIPT])).not.toThrow();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-stream-'));
    const broken = path.join(dir, 'broken.sh');
    fs.writeFileSync(broken, readScript().replace('while true; do', 'while true; d'));
    expect(() => execFileSync('sh', ['-n', broken], { stdio: 'ignore' })).toThrow();
  });

  it('★ 引数が足りなければ、使い方を出して止まる (黙って空の宛先へつながない)', () => {
    let out = '';
    let code = 0;
    try {
      execFileSync('sh', [SCRIPT], { encoding: 'utf8' });
    } catch (e) {
      const err = e as { status: number; stdout: string };
      code = err.status;
      out = err.stdout;
    }
    expect(code).toBe(2);
    expect(out).toContain('使い方');
  });

  it('★★ スクリプトでも、トークンが有効なら login を呼ばない (#427 と同じ振る舞い)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-stream-auth-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const auth = path.join(dir, 'auth.json').replace(/\\/g, '/');
    fs.writeFileSync(auth, JSON.stringify({ login_id: 'STUB', password: 'stub-pw' }));
    const d = dir.replace(/\\/g, '/');
    fs.writeFileSync(path.join(bin, 'curl'), [
      '#!/bin/sh',
      'for a in "$@"; do case "$a" in *api/auth/login*) echo x >> "' + d + '/logins"; printf \'{"token":"tok-new"}\'; exit 0 ;; esac; done',
      'printf \'{"max_age_ms":3300000}\\n200\'',
    ].join('\n'), { mode: 0o755 });
    const s = readScript();
    const prologue = s.slice(0, s.indexOf('while true; do'));
    const script = `${prologue}\nTOKEN='tok-old'; auth_prepare\nprintf 'RESULT token=%s code=%s\\n' "$TOKEN" "$CODE"\n`;
    const out = execFileSync('sh', ['-c', script, 'sh', 'stubproj', 'http://stub.invalid', 'http://stub.invalid/agent-api/cc-queue', auth], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    });
    expect(out).toContain('RESULT token=tok-old code=200');
    expect(fs.existsSync(path.join(dir, 'logins'))).toBe(false);
  });
});

/**
 * #484 「粘らず落ちる」選択肢 (CC_STREAM_GIVE_UP) — PaneDeck 班の依頼 (2026-10-05)
 * ★ PaneDeck の service の中で永久に粘ると「つながっていないのにプロセスは生きている」になり、
 *   静かな日と見分けが付かない。落ちれば PaneDeck が起こし直し、再起動の回数をツールバーに出す。
 * ★★ 既定は今のまま粘る (Claude Code の Monitor には起こし直す者がいないので、それが正しい)
 */
/**
 * つながらない curl と、待たない sleep で、接続のループを回す。
 * stream: /stream の振る舞い (sh)。$N は何回目の /stream か。既定は「つながらない」(curl=7)
 */
function runFailingLoop(env: Record<string, string>, killAfterSleeps: number, stream = 'exit 7') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-stream-giveup-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const d = dir.replace(/\\/g, '/');
  const auth = `${d}/auth.json`;
  fs.writeFileSync(auth, JSON.stringify({ login_id: 'STUB', password: 'stub-pw' }));
  // ★ login は通し、/pending は 200 (max_age あり)、/stream は「つながらない」(curl=7)
  fs.writeFileSync(path.join(bin, 'curl'), [
    '#!/bin/sh',
    'for a in "$@"; do case "$a" in',
    `  *api/auth/login*) printf '{"token":"tok"}'; exit 0 ;;`,
    `  *pending*) printf '{"max_age_ms":3300000}\\n200'; exit 0 ;;`,
    `  *stream?*) echo x >> "${d}/streams"; N=$(wc -l < "${d}/streams" | tr -d ' '); ${stream} ;;`,
    'esac; done',
    'exit 0',
  ].join('\n'), { mode: 0o755 });
  // ★ sleep は待たない。決めた回数を超えたら親 (スクリプト) を止める = 「終わらなかった」の印
  fs.writeFileSync(path.join(bin, 'sleep'), [
    '#!/bin/sh',
    `echo x >> "${d}/sleeps"`,
    `N=$(wc -l < "${d}/sleeps" | tr -d ' ')`,
    `[ "$N" -ge ${killAfterSleeps} ] && kill -TERM $PPID`,
    'exit 0',
  ].join('\n'), { mode: 0o755 });
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  let status = 0;
  let out = '';
  try {
    out = execFileSync('sh', [SCRIPT, 'stubproj', 'http://stub.invalid', 'http://stub.invalid/agent-api/cc-queue', auth], {
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, ...env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    });
  } catch (e) {
    const err = e as { status: number | null; signal: string | null; stdout: string };
    status = err.status ?? (err.signal ? 143 : -1);
    out = err.stdout ?? '';
  }
  const count = (f: string) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').length : 0);
  return { status, out, streams: count('streams') };
}

describe('cc-stream.sh — 粘らず落ちる (CC_STREAM_GIVE_UP、#484)', () => {

  it('★★ CC_STREAM_GIVE_UP=2 なら、想定外の切断が 2 回続いたところで exit 1 し、理由を 1 行出す', () => {
    const r = runFailingLoop({ CC_STREAM_GIVE_UP: '2' }, 10);
    expect(r.status).toBe(1);
    expect(r.streams).toBe(2);
    expect(r.out).toContain('[stream] gave up after 2 unexpected disconnects');
  });

  it('★ 付けなければ、何回切れても終わらない (今までどおり粘る)', () => {
    const r = runFailingLoop({}, 4);
    expect(r.out).not.toContain('gave up');
    expect(r.streams).toBeGreaterThanOrEqual(4);
  });

  it('★ 数でない値・0 は付けていないのと同じ (書き間違いで黙って落ちる側に倒さない)', () => {
    for (const v of ['abc', '0']) {
      const r = runFailingLoop({ CC_STREAM_GIVE_UP: v }, 4);
      expect(r.out).not.toContain('gave up');
      expect(r.streams).toBeGreaterThanOrEqual(4);
    }
  });
});

/**
 * #512 /pending は通るのに /stream だけすぐ切れると、3〜12 秒ごとに Claude を起こし続けていた
 * ★ 周回の頭で /pending が通るたびに「recovered」を出して FAILS を 0 に戻していたので、
 *   毎周「想定外 1 回目」+「recovered」の 2 回起こし、1・2・4・8 回目だけの間引きも効かなかった。
 *   Monitor は知らせが多すぎる監視を止めるので、壊れているときに限って待ち受けが黙って止まる
 */
describe('cc-stream.sh — 受信の口だけ壊れたときに起こし続けない (#512)', () => {
  /** stdout の行 = Claude を起こす知らせ */
  const wakes = (out: string) => out.split('\n').filter(Boolean);

  it('★★★ /stream がすぐ切れ続けても、起こすのは 1・2・4・8・16 回目だけ。「recovered」は出さない', () => {
    const r = runFailingLoop({}, 20);
    expect(r.streams).toBeGreaterThanOrEqual(20);
    expect(r.out).not.toContain('recovered');
    expect(wakes(r.out).map((l) => (l.match(/想定外 (\d+) 回目/) || [])[1])).toEqual(['1', '2', '4', '8', '16']);
  });

  it('★★ /stream がエラーの本文を返してすぐ終わる形でも、[stream-error] は間引く', () => {
    const r = runFailingLoop({}, 20, "printf 'Bad Gateway'; exit 0");
    const errs = wakes(r.out).filter((l) => l.startsWith('[stream-error]'));
    expect(r.streams).toBeGreaterThanOrEqual(20);
    expect(errs.length).toBe(5);
  });

  it('★★ /stream から 1 行受け取れたら「recovered」を出す (その接続が本物だった)', () => {
    // 1・2 回目はつながらない → 3 回目は heartbeat を 1 行返してから終わる
    const r = runFailingLoop({}, 4, `[ "$N" -ge 3 ] && { printf '{"__hb":1}\n'; exit 0; }; exit 7`);
    const lines = wakes(r.out);
    expect(lines.some((l) => /recovered after 2 attempts/.test(l))).toBe(true);
  });
});

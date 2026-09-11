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

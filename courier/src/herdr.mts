/**
 * 届け先 herdr (docs/12 §6・§8 の 4・11〜15)。外のコマンドの呼び出しは注入する (手元で実行 / SSH で実行の差し替え)。
 *
 * ★ 使う口は `agent get` と `agent prompt` だけ。`pane send-text` は確認待ち (blocked) への歯止めが無いので使わない (§8 の 12)
 * ★ 状態は herdr が返す JSON の agent_status を見る (文字の一部一致で読まない。§8 の 13: 「not running」を running と読んだ)
 * ★ 確認待ち (blocked) には打たない (§8 の 4)。打った文字が確認への答えになる
 * ★ 押し直しはしない (`agent prompt --wait --until working` が相手の側で動き出しを確かめる。こちらから見張ると二重配達になりうる)
 * ★ CLI の正確な引数は、移すときに本物の herdr (版を固定) で確かめる (この機械にはまだ入っていない。試験は偽の run で)
 */

export type CourierStatus = 'idle' | 'busy' | 'blocked' | 'missing' | 'unknown';

export interface Courier {
  status(): Promise<CourierStatus>;
  deliver(text: string): Promise<{ ok: true; ref: string } | { ok: false; error: string }>;
  /** 相手の進み具合 (herdr の state_change_seq)。打ったあとの戻りが失われたとき、動いたかを見るのに使う (docs/12 §13.2)。分からなければ null */
  progress?(): Promise<number | null>;
}

export interface RunResult { code: number; stdout: string; stderr: string }
export type Run = (command: string, args: string[]) => Promise<RunResult>;

/** herdr の agent_status から、渡してよいかへ */
export function mapAgentStatus(s: unknown): CourierStatus {
  switch (s) {
    case 'idle':
    case 'done':
      return 'idle';
    case 'working':
      return 'busy';
    case 'blocked':
      return 'blocked';
    default:
      return 'unknown';
  }
}

/** herdr の失敗は stdout の JSON {"error":{"code":…}} で返る (0.9.5 の実物、2026-11-19) */
function errorCode(r: RunResult): string | null {
  // ★ 0.9.5 の実物は失敗の JSON を stderr に出す (stdout は空。2026-11-20 学習ループ 2 で確かめた。11-19 の「stdout」は誤り)。
  //   SSH 越しなら前置きの警告の行が先に来るので、行ごとに JSON を探す。stdout も念のため見る
  for (const text of [r.stdout, r.stderr]) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const v = JSON.parse(line) as { error?: { code?: unknown } };
        if (typeof v.error?.code === 'string') return v.error.code;
      } catch { /* 次の行 */ }
    }
  }
  return null;
}

/** 打ったが動き出しを確かめられなかった (文字は相手に入っている)。届かなかったと扱うと打ち直しで二重になる */
const UNCERTAIN_CODES = new Set(['unreachable', 'timeout', 'agent_prompt_stalled']);

/** 届け先が居ない (サーバが動いていない・その名前のエージェントが居ない) と分かる失敗 */
const MISSING_CODES = new Set(['server_not_running', 'agent_not_found', 'not_found', 'unreachable']);

/**
 * `herdr agent get` の出力から相手の進み具合 (state_change_seq) を読む。読めなければ null。改善ループ 117 で progress() から出した。
 * ★ これが黙って null を返し続けると「届いたか分からない」ときの確かめ (tick.mts) が効かなくなり、
 *   打ち直しが「届かなかった」扱いになる (二重に届けうる)。0.9.5 の実物の形をテストで固定している (ssh.test.mts)
 */
export function parseStateSeq(stdout: string): number | null {
  try {
    const v = JSON.parse(stdout) as { result?: { agent?: { state_change_seq?: unknown } } };
    const n = v.result?.agent?.state_change_seq;
    return typeof n === 'number' ? n : null;
  } catch {
    return null;
  }
}

export function herdrCourier(run: Run, agent: string, opts: { bin?: string; timeoutMs?: number } = {}): Courier {
  const bin = opts.bin ?? 'herdr';
  const timeout = String(opts.timeoutMs ?? 5000);
  return {
    async progress() {
      try {
        const r = await run(bin, ['agent', 'get', agent]);
        return r.code === 0 ? parseStateSeq(r.stdout) : null;
      } catch {
        return null;
      }
    },
    async status() {
      let r: RunResult;
      try { r = await run(bin, ['agent', 'get', agent]); } catch { return 'unknown'; }
      if (r.code !== 0) {
        const code = errorCode(r);
        if (code !== null) return MISSING_CODES.has(code) ? 'missing' : 'unknown';
        return /not found|no such agent/i.test(r.stderr) ? 'missing' : 'unknown';
      }
      try {
        // ★ 0.9.5 の実物は {"result":{"agent":{"agent_status":…}}} (2026-11-19 PaneDeck 班が取った)
        const v = JSON.parse(r.stdout) as { result?: { agent?: { agent_status?: unknown } } };
        return mapAgentStatus(v.result?.agent?.agent_status);
      } catch {
        return 'unknown';   // ★ JSON でなければ読まない (一部一致で running と読み違えない)
      }
    },
    async deliver(text: string) {
      let r: RunResult;
      try {
        r = await run(bin, ['agent', 'prompt', agent, text, '--wait', '--until', 'working', '--until', 'done', '--timeout', timeout]);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (r.code === 0) return { ok: true, ref: `${agent}@${Date.now()}` };
      const code = errorCode(r);
      // ★ SSH 越しで、つながらなかったのか・打ったあとの戻りだけ失ったのか分からない (255) → uncertain (docs/12 §13.2)
      if (code !== null && UNCERTAIN_CODES.has(code)) return { ok: false, error: 'uncertain' };
      if (code === 'agent_blocked' || /agent_blocked/.test(r.stderr)) return { ok: false, error: 'blocked' };
      return { ok: false, error: code ?? `herdr agent prompt が ${r.code} で終わりました` };
    },
  };
}

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
  try {
    const v = JSON.parse(r.stdout) as { error?: { code?: unknown } };
    return typeof v.error?.code === 'string' ? v.error.code : null;
  } catch {
    return null;
  }
}

/** 届け先が居ない (サーバが動いていない・その名前のエージェントが居ない) と分かる失敗 */
const MISSING_CODES = new Set(['server_not_running', 'agent_not_found', 'not_found']);

export function herdrCourier(run: Run, agent: string, opts: { bin?: string; timeoutMs?: number } = {}): Courier {
  const bin = opts.bin ?? 'herdr';
  const timeout = String(opts.timeoutMs ?? 5000);
  return {
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
      if (code === 'agent_blocked' || /agent_blocked/.test(r.stderr)) return { ok: false, error: 'blocked' };
      return { ok: false, error: code ?? `herdr agent prompt が ${r.code} で終わりました` };
    },
  };
}

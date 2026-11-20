/**
 * 段階 2: 相手の PC の herdr を SSH で 1 回ずつ呼ぶ (docs/12 §13.1、PaneDeck 班の試験 2026-11-18〜19 の形)。
 *
 * ★ 相手は Windows の OpenSSH で、コマンドは相手のシェル (cmd) を通る。引数は 1 つずつ "…" で囲んで 1 本の文字列にする
 * ★ 相手のシェルで意味を持つ文字 (" と % と改行) を含む引数は送らない (文面はひな型から作るので、普通は入らない)
 * ★ -o ConnectTimeout=5 -o BatchMode=yes (つながらないときに待ち続けない・パスワードを聞かない)。漢字のユーザ名は -l で渡す
 * ★ つながらない (ssh の終了コード 255) は、herdr の「居ない」と同じ形の失敗 ({"error":{"code":"unreachable"}}) にする
 */
import type { Run, RunResult } from './herdr.mts';

export function isSafeRemoteArg(a: string): boolean {
  return !/["%\r\n]/.test(a);
}

export function sshRun(base: Run, target: { host: string; user: string }): Run {
  return async (command: string, args: string[]): Promise<RunResult> => {
    const all = [command, ...args];
    if (!all.every(isSafeRemoteArg)) {
      return { code: 2, stdout: '{"error":{"code":"unsafe_argument"}}', stderr: '相手のシェルで意味を持つ文字を含む引数は送りません' };
    }
    // ★ 逆斜線は斜線にする (Windows は斜線の道も読める)。どの ssh (Windows の OpenSSH / Git の ssh) を通っても、
    //   途中の引数の読み直しで逆斜線が消える心配をなくすため (2026-11-20 の試験で、逆斜線が消えて相手で見つからない形を見た)
    const remote = all.map((a) => `"${a.replace(/\\/g, '/')}"`).join(' ');
    const r = await base('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', '-l', target.user, target.host, remote]);
    if (r.code === 255) return { code: 255, stdout: '{"error":{"code":"unreachable"}}', stderr: r.stderr };
    return r;
  };
}

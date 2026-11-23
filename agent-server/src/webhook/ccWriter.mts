/**
 * 受け箱の持ち主の札 `.writer.json` (#650、docs/14 §6、2026-11-23)。agent-server の写し (役は agent-server)。
 *
 * ★ 受け箱を書くのは 1 プロセスだけ。切り詰めは読んで書き直すので、本体と agent-server が同時に書くと行が消え、同じ便を 2 回積むこともある。
 *   設定 (`CC_INTAKE`) だけに頼らず、受け箱のフォルダに札を置いて**書くたびに見る** (起動時だけにすると、戻すとき誰も書かなくなる)。
 *
 * 札を取ってよいとき:
 *   - 札が無い・壊れている
 *   - 札が自分の役で同じ機械 = 前の自分 (★ PID は見ない。再起動後に PID が別のプロセスに使い回されて、自分の札に締め出されないように)
 *   - 札が別の機械のもの (Syncthing で受け箱を写している機械では札も写る。別の機械のプロセスの生死はここから見えない)
 *   - 札の持ち主 (別の役) のプロセスが死んでいる
 * 取ってはいけないとき: 同じ機械で、別の役のプロセスが生きている → 書かずに error に便の id を残す
 *
 * ★ 本体 (server/src/services/cc/ccWriter.mts) にも同じ札の読み書きがある (包みをまたぐ import は CI で落ちるので写し)。札の形を変えるときは両方を直す
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type CcWriterRole = 'server' | 'agent-server';

export interface CcWriterTag {
  process: CcWriterRole;
  host: string;
  pid: number;
  started_at: string;
}

export const WRITER_FILE = '.writer.json';
const STARTED_AT = new Date().toISOString();

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readWriterTag(dir: string): CcWriterTag | null {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(dir, WRITER_FILE), 'utf8')) as Partial<CcWriterTag>;
    if ((t.process !== 'server' && t.process !== 'agent-server') || typeof t.host !== 'string' || typeof t.pid !== 'number') return null;
    return { process: t.process, host: t.host, pid: t.pid, started_at: String(t.started_at ?? '') };
  } catch {
    return null;
  }
}

export interface ClaimDeps {
  role?: CcWriterRole;
  host?: string;
  pid?: number;
  isAlive?: (pid: number) => boolean;
}

export type ClaimResult = { ok: true } | { ok: false; holder: CcWriterTag };

/** 書く前に呼ぶ。取れたら (or 既に自分のなら) ok。生きている別の役が持っていたら holder を返す */
export function claimWriter(dir: string, deps: ClaimDeps = {}): ClaimResult {
  const role = deps.role ?? 'agent-server';
  const host = deps.host ?? os.hostname();
  const pid = deps.pid ?? process.pid;
  const isAlive = deps.isAlive ?? isProcessAlive;
  const cur = readWriterTag(dir);
  if (cur && cur.process === role && cur.host === host && cur.pid === pid) return { ok: true };
  if (cur && cur.host === host && cur.process !== role && isAlive(cur.pid)) return { ok: false, holder: cur };
  fs.mkdirSync(dir, { recursive: true });
  const tag: CcWriterTag = { process: role, host, pid, started_at: STARTED_AT };
  const tmp = path.join(dir, `${WRITER_FILE}.${pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(tag));
  fs.renameSync(tmp, path.join(dir, WRITER_FILE));
  return { ok: true };
}

/**
 * 止まるとき・受け付けをやめるときに呼ぶ。自分の役で同じ機械の札なら外す (別の役の札は触らない)。
 * ★ PID は見ない (1 つの機械に同じ役は 1 つ)。前の自分が強制終了で残した札も、起動時にここで外せる。
 *   PID で絞ると、残った札の PID を Windows が別のプロセスに使い回したとき、相手の役が「生きている」と読んでずっと書けなくなる (#650 の監査 1)
 */
export function releaseWriter(dir: string, deps: Pick<ClaimDeps, 'role' | 'host'> = {}): void {
  const cur = readWriterTag(dir);
  if (!cur) return;
  if (cur.process === (deps.role ?? 'agent-server') && cur.host === (deps.host ?? os.hostname())) {
    fs.rmSync(path.join(dir, WRITER_FILE), { force: true });
  }
}

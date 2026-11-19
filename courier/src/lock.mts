/**
 * 班ごとの鍵 (docs/12 §4.4)。1 つの班 (queue) に配る人は 1 人。
 * ★ 鍵の持ち主のプロセスが生きているかを見る (PaneDeck 班 11-17: 強制終了で古い鍵が残り、二重配達とコピーが起きた)
 * ★ 置き場は ~/.tealus/courier/ (docs/12 §12.3)
 */
import fs from 'node:fs';
import path from 'node:path';
import { isValidProject } from './cursor.mts';

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockPath(dir: string, project: string): string {
  if (!isValidProject(project)) throw new Error(`project 名の形が違います: ${JSON.stringify(project)}`);
  return path.join(dir, `lock-${project}.json`);
}

function ownerOf(p: string): number | null {
  try {
    const n = Number((JSON.parse(fs.readFileSync(p, 'utf8')) as { pid?: unknown }).pid);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** 取れたら true。生きている別のプロセスが持っていたら false。死んだ持ち主・壊れた鍵は取り返す */
export function acquireLock(dir: string, project: string, pid = process.pid, isAlive: (pid: number) => boolean = processAlive): boolean {
  const p = lockPath(dir, project);
  fs.mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(p, JSON.stringify({ pid, at: new Date().toISOString() }), { flag: 'wx' });   // ★ 無いときだけ作る
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const owner = ownerOf(p);
    if (owner === pid) return true;
    if (owner !== null && isAlive(owner)) return false;
    fs.rmSync(p, { force: true });   // 死んだ持ち主・壊れた鍵 → 消して、次の回で作る
  }
  return false;
}

export function releaseLock(dir: string, project: string, pid = process.pid): void {
  const p = lockPath(dir, project);
  if (ownerOf(p) === pid) fs.rmSync(p, { force: true });
}

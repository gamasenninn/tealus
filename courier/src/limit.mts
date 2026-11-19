/**
 * 配達の上限 (docs/12 §8 の 8・§12.4)。班ごとに 1 時間に 20 通を超えたら保留する (2026-11-19 利用者)。
 * ★ 人が居ない・道具を広げた班どうしが @cc- で起こし合うと、止める人が居ないまま回るため
 * ★ 保留は捨てない。印をファイルに置き、人が消すまで戻さない (段階 1 は消す口を作らない)
 */
import fs from 'node:fs';
import path from 'node:path';
import { isValidProject } from './cursor.mts';

export const DEFAULT_MAX_PER_HOUR = 20;

export class RateLimiter {
  private sent = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  private now: () => number;

  // ★ 引数で private を宣言する書き方は使えない (Node の型の取り除きで動かすため。erasableSyntaxOnly)
  constructor(max = DEFAULT_MAX_PER_HOUR, windowMs = 60 * 60_000, now: () => number = Date.now) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** 1 通ぶん使ってよければ true (使ったことにする)。上限なら false */
  take(project: string): boolean {
    const t = this.now();
    const list = (this.sent.get(project) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length >= this.max) {
      this.sent.set(project, list);
      return false;
    }
    list.push(t);
    this.sent.set(project, list);
    return true;
  }
}

function holdPath(dir: string, project: string): string {
  if (!isValidProject(project)) throw new Error(`project 名の形が違います: ${JSON.stringify(project)}`);
  return path.join(dir, `hold-${project}.json`);
}

export function isHeld(dir: string, project: string): boolean {
  return fs.existsSync(holdPath(dir, project));
}

export function setHold(dir: string, project: string, reason: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(holdPath(dir, project), JSON.stringify({ reason, at: new Date().toISOString() }));
}

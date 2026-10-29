/**
 * メディアの総量・ディスクの空き・常駐のメモリを 1 行に出す口 (2026-10-29 小野さん判断 13)。
 *
 * ★ なぜ要るか: メディアは消さない方針 (10-10、将来は本体ごと NAS へ) で、1 日 300〜500MB 増える。
 *   常駐のメモリも記録が無く、長く動かしたときの傾向を見る手段が無かった。人が見に行くまで分からない
 * ★ 約束 (他の doctor の口と同じ):
 *   1. 測れなかったものを「十分」と言わない (もつ日数も言わない)
 *   2. 空きが残り 90 日分を切ったら warn
 *   3. 正常なら info
 * ★ 置き場のパスは出さない (値は出さない、の約束に寄せる)。大きさと日数だけ
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Finding } from './doctor.mts';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
export const CAPACITY_WARN_DAYS = 90;

export interface CapacityInput {
  media: { totalBytes: number; last30Bytes: number } | null;
  freeBytes: number | null;
  procs: Array<{ name: string; rssBytes: number; hoursUp: number }>;
}

const gb = (b: number) => `${(b / GB).toFixed(1)}GB`;

export function judgeCapacity(input: CapacityInput): Finding {
  const parts: string[] = [];
  let level: Finding['level'] = 'info';
  parts.push(input.media
    ? `メディア ${gb(input.media.totalBytes)} (直近 30 日で ${gb(input.media.last30Bytes)} 増)`
    : 'メディアの総量は測れませんでした');
  parts.push(input.freeBytes !== null ? `空き ${gb(input.freeBytes)}` : '空きは測れませんでした');
  if (input.media && input.freeBytes !== null && input.media.last30Bytes > 0) {
    const days = Math.floor(input.freeBytes / (input.media.last30Bytes / 30));
    parts.push(`今のペースで約 ${days} 日もつ`);
    if (days < CAPACITY_WARN_DAYS) level = 'warn';
  }
  if (input.procs.length > 0) {
    parts.push('メモリ ' + input.procs.map((p) => `${p.name} ${Math.round(p.rssBytes / MB)}MB (起動から ${p.hoursUp.toFixed(1)} 時間)`).join(' / '));
  }
  return {
    id: 'capacity',
    level,
    detail: parts.join('、'),
    fix: level === 'warn'
      ? `空きが ${CAPACITY_WARN_DAYS} 日分を切りました。メディアの置き場を移す (本体ごと NAS へ) 時期を決めてください`
      : 'メモリは日をまたいで見比べると、増え続けているかが分かります',
  };
}

/** 置き場の総量と、直近 30 日に書かれた分 (更新時刻で数える)。読めなければ null */
export async function measureMedia(dir: string, now: Date): Promise<CapacityInput['media']> {
  if (!fs.existsSync(dir)) return null;
  const since = now.getTime() - 30 * 86_400_000;
  let totalBytes = 0;
  let last30Bytes = 0;
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!e.isFile()) continue;
      const st = await fs.promises.stat(p);
      totalBytes += st.size;
      if (st.mtimeMs >= since) last30Bytes += st.size;
    }
  };
  try {
    await walk(dir);
    return { totalBytes, last30Bytes };
  } catch {
    return null;
  }
}

export async function measureFree(dir: string): Promise<number | null> {
  try {
    const s = await fs.promises.statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/** 本体・agent-server・rtc-server のメモリ (Windows だけ。ほかの OS や読めないときは空) */
export function measureProcs(now: Date): Promise<CapacityInput['procs']> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const script = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object CommandLine,WorkingSetSize,CreationDate | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', script], { timeout: 20_000, windowsHide: true }, (err, stdout) => {
      if (err) { resolve([]); return; }
      try {
        const raw = JSON.parse(stdout || '[]');
        const rows: Array<{ CommandLine?: string; WorkingSetSize?: number; CreationDate?: string }> = Array.isArray(raw) ? raw : [raw];
        const names: Array<[RegExp, string]> = [[/src[\\/]app\.mts/, '本体'], [/src[\\/]index\.mts/, 'agent-server'], [/server\.mts/, 'rtc-server']];
        const out: CapacityInput['procs'] = [];
        for (const [re, name] of names) {
          const r = rows.find((x) => x.CommandLine && re.test(x.CommandLine) && !/doctor/.test(x.CommandLine));
          if (!r || typeof r.WorkingSetSize !== 'number') continue;
          // ★ Windows PowerShell 5.1 の ConvertTo-Json は日時を "/Date(1730…)/" で出す
          const ms = r.CreationDate ? /\/Date\((\d+)\)\//.exec(r.CreationDate)?.[1] : undefined;
          const started = ms ? Number(ms) : (r.CreationDate ? Date.parse(r.CreationDate) : NaN);
          out.push({ name, rssBytes: r.WorkingSetSize, hoursUp: Number.isFinite(started) ? (now.getTime() - started) / 3_600_000 : 0 });
        }
        resolve(out);
      } catch {
        resolve([]);
      }
    });
  });
}

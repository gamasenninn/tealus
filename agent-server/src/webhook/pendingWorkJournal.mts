/**
 * AI の仕事の控え (改善ループ 49、2026-11-13)。
 *
 * ★ 部屋ごとの仕事の列 (dispatcher.mts) はメモリの中だけにある。計画的な停止 (Ctrl+C・窓を閉じる) では停止の手順が
 *   部屋に「中断されました」を出すが (droppedWorkNotice.mts)、電源断・Windows の再起動・クラッシュでは手順が走らず黙って消える。
 * ★ 仕事が残っている間だけ、部屋と数をファイルに置く。仕事が無くなったら消す。起動したときに残っていれば、
 *   前のプロセスが予告なく止まったとみなして知らせる (取り直してやり直しはしない。11-12 小野さん判断「知らせるだけ」)
 * ★ 改善ループ 50: 起動時は即消さずに退避 (<file>.prev) し、知らせが済んでから消す (clearLeftover)。
 *   Bot のログインが済む前にもう一度落ちても、次の起動で退避した分と新しい控えを合わせて知らせる
 * ★ 失敗はすべて飲み込む (控えが書けなくても AI の仕事は止めない)。一時ファイル → rename で、書きかけの控えを残さない
 */
import fs from 'node:fs';
import path from 'node:path';

export interface PendingRoom { roomId: string; count: number }
export interface PendingWorkLeftover { at: string; pending: PendingRoom[] }

export interface PendingWorkJournal {
  /** 今の列の中身を書く (空なら消す) */
  record(pending: PendingRoom[]): void;
  /** 今の控えを読むだけ (消さない) */
  readLeftover(): PendingWorkLeftover | null;
  /** 起動時: 前の控えを退避して返す。退避済みの分 (前回知らせ損ねた) があれば合わせる */
  takeLeftover(): PendingWorkLeftover | null;
  /** 知らせが済んだら、退避した分を消す */
  clearLeftover(): void;
  /** 今の控えを消す (計画的な停止で知らせた後) */
  clear(): void;
}

/** ★ Windows ではウイルス対策・索引が一瞬ファイルを掴むことがあるので、消すのは何回か試す */
function removeQuietly(file: string): void {
  try { fs.rmSync(file, { force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* 飲み込む */ }
}

function readFile(file: string): PendingWorkLeftover | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<PendingWorkLeftover>;
    if (typeof v.at !== 'string' || !Array.isArray(v.pending)) return null;
    const pending = v.pending.filter((p): p is PendingRoom => !!p && typeof p.roomId === 'string' && typeof p.count === 'number' && p.count > 0);
    return pending.length ? { at: v.at, pending } : null;
  } catch {
    return null;
  }
}

function writeFile(file: string, value: PendingWorkLeftover): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  } catch { /* 飲み込む */ }
}

/** 2 つの控えを合わせる (部屋ごとに数を足し、時刻は古い方) */
function merge(a: PendingWorkLeftover | null, b: PendingWorkLeftover | null): PendingWorkLeftover | null {
  if (!a) return b;
  if (!b) return a;
  const sum = new Map<string, number>();
  for (const p of [...a.pending, ...b.pending]) sum.set(p.roomId, (sum.get(p.roomId) ?? 0) + p.count);
  return { at: a.at < b.at ? a.at : b.at, pending: [...sum].map(([roomId, count]) => ({ roomId, count })) };
}

export function createPendingWorkJournal(file: string, now: () => Date = () => new Date()): PendingWorkJournal {
  const prevFile = `${file}.prev`;
  const clear = (): void => { removeQuietly(file); removeQuietly(`${file}.tmp`); };
  return {
    record(pending) {
      if (pending.length === 0) { clear(); return; }
      writeFile(file, { at: now().toISOString(), pending });
    },
    readLeftover: () => readFile(file),
    takeLeftover() {
      const all = merge(readFile(prevFile), readFile(file));
      if (all) writeFile(prevFile, all);
      clear();
      return all;
    },
    clearLeftover: () => removeQuietly(prevFile),
    clear,
  };
}

/**
 * AI の仕事の控え (改善ループ 49、2026-11-13)。
 *
 * ★ 部屋ごとの仕事の列 (dispatcher.mts) はメモリの中だけにある。計画的な停止 (Ctrl+C・窓を閉じる) では停止の手順が
 *   部屋に「中断されました」を出すが (droppedWorkNotice.mts)、電源断・Windows の再起動・クラッシュでは手順が走らず黙って消える。
 * ★ 仕事が残っている間だけ、部屋と数をファイルに置く。仕事が無くなったら消す。起動したときに残っていれば、
 *   前のプロセスが予告なく止まったとみなして知らせる (取り直してやり直しはしない。11-12 小野さん判断「知らせるだけ」)
 * ★ 失敗はすべて飲み込む (控えが書けなくても AI の仕事は止めない)。一時ファイル → rename で、書きかけの控えを残さない
 */
import fs from 'node:fs';
import path from 'node:path';

export interface PendingRoom { roomId: string; count: number }
export interface PendingWorkLeftover { at: string; pending: PendingRoom[] }

export interface PendingWorkJournal {
  record(pending: PendingRoom[]): void;
  readLeftover(): PendingWorkLeftover | null;
  clear(): void;
}

export function createPendingWorkJournal(file: string, now: () => Date = () => new Date()): PendingWorkJournal {
  const clear = (): void => { try { fs.rmSync(file, { force: true }); } catch { /* 飲み込む */ } };
  return {
    record(pending) {
      if (pending.length === 0) { clear(); return; }
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ at: now().toISOString(), pending }));
        fs.renameSync(tmp, file);
      } catch { /* 飲み込む */ }
    },
    readLeftover() {
      try {
        const v = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<PendingWorkLeftover>;
        if (typeof v.at !== 'string' || !Array.isArray(v.pending)) return null;
        const pending = v.pending.filter((p): p is PendingRoom => !!p && typeof p.roomId === 'string' && typeof p.count === 'number' && p.count > 0);
        return pending.length ? { at: v.at, pending } : null;
      } catch {
        return null;
      }
    },
    clear,
  };
}

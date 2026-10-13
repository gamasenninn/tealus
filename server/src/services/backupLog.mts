/**
 * バックアップの記録を読んで判定する (#595、もとは agent-server の doctorBackup 2026-10-01)。
 *
 * ★ 見張り (docs/09) と agent-server の doctor が**同じ判定を使う**ために本体側へ移した。
 *   同じ判定を 2 か所に書くと、片方だけ直して食い違い、壊れを隠す。
 *   agent-server はこの module を import する (doctorDeep が本体の migrationPlan を読むのと同じ向き)。
 *
 * ★ 記録の形は `backup-YYYYMMDD.log`。1 回ごとに「=== 開始 ===」で始まり、成功すれば「=== 終了: 成功 ===」で終わる。
 *   書くのは repo の `scripts/backup/tealus-backup.ps1` (#595 で Tealus の機能にした)。この 2 つの文字列は約束。
 * ★★ 見ていないもの・読めないものを「成功」と言わない (ok 以外の 3 つはすべて異常として扱える形で返す)。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 毎日 1 回のバックアップが 1 回飛んだら異常 (24h + 実行時間の揺れ 2h) */
export const BACKUP_STALE_HOURS = 26;
const SUCCESS_MARK = '=== 終了: 成功 ===';
const START_MARK = '=== 開始 ===';
const LOG_RE = /^backup-(\d{8})\.log$/;

export interface LatestBackupLog {
  name: string;
  content: string;
  mtime: Date;
}

export interface BackupRead {
  latest: LatestBackupLog | null;
  readError?: string;
}

export type BackupAssessment =
  | { kind: 'ok'; name: string; hours: number }
  | { kind: 'bad'; name: string; hours: number; why: string }
  | { kind: 'none' }
  | { kind: 'read-error'; error: string };

/** 置き場から、名前の日付がいちばん新しい記録を読む。★ 例外を投げない */
export function readLatestBackupLog(dir: string): BackupRead {
  try {
    const names = fs.readdirSync(dir).filter((n) => LOG_RE.test(n)).sort();
    const name = names[names.length - 1];
    if (!name) return { latest: null };
    const file = path.join(dir, name);
    const content = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return { latest: { name, content, mtime: fs.statSync(file).mtime } };
  } catch (err) {
    return { latest: null, readError: err instanceof Error ? err.message : String(err) };
  }
}

export function assessBackup(read: BackupRead, now: Date): BackupAssessment {
  if (read.readError) return { kind: 'read-error', error: read.readError };
  if (!read.latest) return { kind: 'none' };
  const { name, content, mtime } = read.latest;
  const hours = Math.floor((now.getTime() - mtime.getTime()) / 3_600_000);
  // ★ 同じ日に 2 回流すと記録は同じファイルに追記される。**最後の回だけ**で決める
  //   (以前はファイルのどこかに成功の印があれば成功と読み、朝の成功が昼の失敗を隠した。2026-10-13 の試走で気づいた)。
  //   途中で止まって「終了」が無い回も、成功の印が無いので失敗になる
  const lastRun = content.lastIndexOf(START_MARK);
  const ok = content.slice(Math.max(0, lastRun)).includes(SUCCESS_MARK);
  const stale = hours > BACKUP_STALE_HOURS;
  if (ok && !stale) return { kind: 'ok', name, hours };
  const why = [!ok ? '最後の記録に「終了: 成功」がありません' : '', stale ? `${BACKUP_STALE_HOURS} 時間より古い` : '']
    .filter(Boolean).join(' / ');
  return { kind: 'bad', name, hours, why };
}

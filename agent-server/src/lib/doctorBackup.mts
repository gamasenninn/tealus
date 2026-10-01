/**
 * 最後に成功したバックアップを見る口 (2026-10-01)。
 *
 * ★ なぜ要るか: 本番のバックアップのタスクは「ログインしている間だけ」動く。再起動のあと誰もログインしないと
 *   **黙って止まる**。朝に人が記録を見に行くことでしか気づけなかった。
 * ★ 置き場は採用者ごとに違うので、`BACKUP_LOG_DIR` が設定されているときだけ見る。
 *   記録の形は `backup-YYYYMMDD.log` で、成功した日は最後に「=== 終了: 成功 ===」が出る。
 *
 * ★★ 約束 (ci-status / due-dates と同じ):
 *   1. 見ていないもの・読めないものを「成功」と言わない
 *   2. 古い・失敗は warn。何時間前かを出す
 *   3. 正常なら info (★ 毎日鳴る口は読まれなくなる)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from './doctor.mts';

/** 毎日 1 回のバックアップが 1 回飛んだら鳴る (24h + 実行時間の揺れ 2h) */
export const BACKUP_STALE_HOURS = 26;
const SUCCESS_MARK = '=== 終了: 成功 ===';
const LOG_RE = /^backup-(\d{8})\.log$/;

export interface LatestBackupLog {
  name: string;
  content: string;
  mtime: Date;
}

export interface BackupInput {
  dir: string | undefined;
  latest: LatestBackupLog | null;
  readError?: string;
}

/** 置き場から、名前の日付がいちばん新しい記録を読む。★ 例外を投げない */
export function readLatestBackupLog(dir: string): { latest: LatestBackupLog | null; readError?: string } {
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

export function judgeBackup(input: BackupInput, now: Date): Finding {
  const id = 'backup';
  if (!input.dir) {
    return {
      id, level: 'info',
      detail: '★ BACKUP_LOG_DIR が未設定なので、バックアップの記録を見ていません',
      fix: 'バックアップの記録 (backup-YYYYMMDD.log) の置き場を agent-server/.env の BACKUP_LOG_DIR に書くと、ここで見ます',
    };
  }
  if (input.readError) {
    return {
      id, level: 'warn',
      detail: `バックアップの記録の置き場を読めません: ${input.dir} (${input.readError})`,
      fix: '置き場 (NAS など) に届くか、BACKUP_LOG_DIR が正しいかを確かめてください',
    };
  }
  if (!input.latest) {
    return {
      id, level: 'warn',
      detail: `バックアップの記録が 1 つもありません: ${input.dir}`,
      fix: 'バックアップのタスクが動いているかを確かめてください',
    };
  }
  const hours = Math.floor((now.getTime() - input.latest.mtime.getTime()) / 3_600_000);
  const ok = input.latest.content.includes(SUCCESS_MARK);
  const stale = hours > BACKUP_STALE_HOURS;
  if (!ok || stale) {
    const why = [!ok ? '最後の記録に「終了: 成功」がありません' : '', stale ? `${BACKUP_STALE_HOURS} 時間より古い` : '']
      .filter(Boolean).join(' / ');
    return {
      id, level: 'warn',
      detail: `最後のバックアップの記録: ${input.latest.name} (${hours} 時間前) — ${why}`,
      fix: '記録の中身を見て、失敗なら手で流してください。★ タスクは「ログインしている間だけ」動く設定のことがあります',
    };
  }
  return {
    id, level: 'info',
    detail: `最後のバックアップ: ${input.latest.name} (${hours} 時間前に成功)`,
    fix: `★ ${BACKUP_STALE_HOURS} 時間より古くなるか、成功の印が無ければ warn になります`,
  };
}

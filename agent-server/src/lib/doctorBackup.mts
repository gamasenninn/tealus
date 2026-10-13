/**
 * 最後に成功したバックアップを見る口 (2026-10-01)。
 *
 * ★ なぜ要るか: 本番のバックアップのタスクは「ログインしている間だけ」動く。再起動のあと誰もログインしないと
 *   **黙って止まる**。朝に人が記録を見に行くことでしか気づけなかった。
 * ★ 置き場は採用者ごとに違うので、`BACKUP_LOG_DIR` が設定されているときだけ見る。
 *   記録の形は `backup-YYYYMMDD.log` で、成功した日は最後に「=== 終了: 成功 ===」が出る。
 *
 * ★★ 判定そのものは本体の `services/backupLog.mts` にある (#595)。本体の見張り (docs/09) と
 *   **同じ判定を使う**ため —— 2 か所に書くと片方だけ直して食い違う。ここは doctor の言葉に直すだけ。
 *
 * ★★ 約束 (ci-status / due-dates と同じ):
 *   1. 見ていないもの・読めないものを「成功」と言わない
 *   2. 古い・失敗は warn。何時間前かを出す
 *   3. 正常なら info (★ 毎日鳴る口は読まれなくなる)
 */
import type { Finding } from './doctor.mts';
import {
  assessBackup, BACKUP_STALE_HOURS, type LatestBackupLog,
} from '../../../server/src/services/backupLog.mts';

export { readLatestBackupLog, BACKUP_STALE_HOURS, type LatestBackupLog } from '../../../server/src/services/backupLog.mts';

export interface BackupInput {
  dir: string | undefined;
  latest: LatestBackupLog | null;
  readError?: string;
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
  const a = assessBackup(input, now);
  switch (a.kind) {
    case 'read-error':
      return {
        id, level: 'warn',
        detail: `バックアップの記録の置き場を読めません: ${input.dir} (${a.error})`,
        fix: '置き場 (NAS など) に届くか、BACKUP_LOG_DIR が正しいかを確かめてください',
      };
    case 'none':
      return {
        id, level: 'warn',
        detail: `バックアップの記録が 1 つもありません: ${input.dir}`,
        fix: 'バックアップのタスクが動いているかを確かめてください',
      };
    case 'bad':
      return {
        id, level: 'warn',
        detail: `最後のバックアップの記録: ${a.name} (${a.hours} 時間前) — ${a.why}`,
        fix: '記録の中身を見て、失敗なら手で流してください。★ タスクは「ログインしている間だけ」動く設定のことがあります',
      };
    case 'ok':
      return {
        id, level: 'info',
        detail: `最後のバックアップ: ${a.name} (${a.hours} 時間前に成功)`,
        fix: `★ ${BACKUP_STALE_HOURS} 時間より古くなるか、成功の印が無ければ warn になります`,
      };
  }
}

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
import fsp from 'node:fs/promises';
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

/** 置き場が応答しないとき、ここで諦める。判定の間隔 (5 分) より十分短く、NAS の普段の応答 (1 秒未満) より十分長い */
export const BACKUP_READ_TIMEOUT_MS = 15_000;

interface BackupFs {
  readdir: (dir: string) => Promise<string[]>;
  readFile: (file: string, enc: 'utf8') => Promise<string>;
  stat: (file: string) => Promise<{ mtime: Date }>;
}

/** ★ 置き場ごとに、終わっていない読み取りの開始時刻を持つ。固まった NAS への読み取りを周回ごとに積まない (積むと libuv の 4 本の手が全部埋まる) */
const inflight = new Map<string, number[]>();
/** ★ 固まった読み取りは置き場ごとにこれだけまで (改善ループ 13 回目)。手を 2 本残し、本体の fs と DNS (DB・OpenAI) を止めない */
const MAX_STUCK_READS = 2;
/**
 * ★ 固まった読み取りがこれだけ戻らなければ、見捨てて次を許す (改善ループ 12 回目)。
 *   見捨てないと、裏の読み取りが永久に戻らないとき印も永久に残り、NAS が戻っても再起動まで ok に戻らない。
 *   判定の間隔 (5 分) の 3 回分。見捨てた読み取りは手を 1 本使ったままなので、本数は MAX_STUCK_READS で抑える
 */
export const BACKUP_READ_ABANDON_MS = 15 * 60_000;

/**
 * 置き場から、名前の日付がいちばん新しい記録を読む。★ 例外を投げない
 *
 * ★★ 非同期で読み、時間で切る (改善ループ 10 回目の D、2026-10-23)。置き場は NAS (UNC) で、
 *   以前は同期 (readdirSync) で読んでいた —— NAS が応答しないと、その間は本体の全部 (チャット・通知) が止まる形だった。
 *   時間で切っても、固まった読み取り自体は裏で残る。なので終わるまで次を重ねない (`inflight`)。
 */
export async function readLatestBackupLog(
  dir: string,
  opts: { fs?: BackupFs; timeoutMs?: number; now?: () => number } = {},
): Promise<BackupRead> {
  const bfs: BackupFs = opts.fs ?? fsp;
  const now = opts.now ?? Date.now;
  const pending = inflight.get(dir) ?? [];
  const newest = pending.length > 0 ? Math.max(...pending) : undefined;
  if (pending.length >= MAX_STUCK_READS || (newest !== undefined && now() - newest < BACKUP_READ_ABANDON_MS)) {
    return { latest: null, readError: '前回の読み取りがまだ終わっていません (置き場が応答していない)' };
  }
  const myStart = now();
  inflight.set(dir, [...pending, myStart]);
  const work = (async (): Promise<BackupRead> => {
    const names = (await bfs.readdir(dir)).filter((n) => LOG_RE.test(n)).sort();
    const name = names[names.length - 1];
    if (!name) return { latest: null };
    const file = path.join(dir, name);
    const content = (await bfs.readFile(file, 'utf8')).replace(/^﻿/, '');
    return { latest: { name, content, mtime: (await bfs.stat(file)).mtime } };
  })().finally(() => {
    // ★ 自分の印だけ外す (見捨てた古い読み取りが、新しい読み取りの印を消さない)
    const rest = (inflight.get(dir) ?? []).filter((t) => t !== myStart);
    if (rest.length > 0) inflight.set(dir, rest); else inflight.delete(dir);
  });
  const timeoutMs = opts.timeoutMs ?? BACKUP_READ_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BackupRead>((resolve) => {
    timer = setTimeout(() => resolve({ latest: null, readError: `置き場が ${Math.round(timeoutMs / 1000)} 秒応答しません` }), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    return { latest: null, readError: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
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

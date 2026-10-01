/**
 * doctor: 最後に成功したバックアップ (2026-10-01)
 *
 * ★ なぜ要るか: バックアップのタスクは「ログインしている間だけ」動く。再起動のあと誰もログインしないと
 *   **黙って止まる**。朝に人が記録を見に行くことでしか気づけなかった
 * ★ 約束 (他の doctor の口と同じ):
 *   1. 見ていないものを「成功」と言わない (置き場が未設定・読めない は「成功」の語を出さない)
 *   2. 古い・失敗は warn。何時間前かを出す
 *   3. 正常なら info (毎日鳴る口は読まれなくなる)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judgeBackup, readLatestBackupLog } from '../../src/lib/doctorBackup.mts';

const NOW = new Date('2026-10-01T12:00:00+09:00');
const OK_LOG = '2026-10-01 03:00:04 DB ok: x.dump 14.0 MB, 表 24\n2026-10-01 03:00:12 === 終了: 成功 ===\n';
const at = (iso: string) => new Date(iso);

describe('judgeBackup', () => {
  it('置き場が未設定なら info。★ 「成功」と言わない', () => {
    const f = judgeBackup({ dir: undefined, latest: null }, NOW);
    expect(f.id).toBe('backup');
    expect(f.level).toBe('info');
    expect(f.detail).toContain('BACKUP_LOG_DIR');
    expect(f.detail).not.toContain('成功');
  });

  it('★ 置き場が読めなければ warn (「成功」と言わない)', () => {
    const f = judgeBackup({ dir: 'S:/x', latest: null, readError: 'ENOENT' }, NOW);
    expect(f.level).toBe('warn');
    expect(f.detail).not.toContain('成功しています');
  });

  it('★ 記録が 1 つも無ければ warn', () => {
    expect(judgeBackup({ dir: 'S:/x', latest: null }, NOW).level).toBe('warn');
  });

  it('今日の 3:00 に成功していれば info で、何時間前かを出す', () => {
    const f = judgeBackup({ dir: 'S:/x', latest: { name: 'backup-20261001.log', content: OK_LOG, mtime: at('2026-10-01T03:00:12+09:00') } }, NOW);
    expect(f.level).toBe('info');
    expect(f.detail).toContain('backup-20261001.log');
    expect(f.detail).toContain('8 時間前'); // 8 時間 59 分 → 切り捨て
  });

  it('★ 最後の記録が 26 時間より古ければ warn (= 1 日飛んだ)', () => {
    const f = judgeBackup({ dir: 'S:/x', latest: { name: 'backup-20260929.log', content: OK_LOG, mtime: at('2026-09-29T03:00:12+09:00') } }, NOW);
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('56 時間前'); // 56 時間 59 分 → 切り捨て
    expect(f.fix.length).toBeGreaterThan(0);
  });

  it('★ 最後の記録に「終了: 成功」が無ければ warn (失敗・途中で止まった)', () => {
    const f = judgeBackup({ dir: 'S:/x', latest: { name: 'backup-20261001.log', content: '2026-10-01 03:00:04 DB 失敗\n', mtime: at('2026-10-01T03:00:12+09:00') } }, NOW);
    expect(f.level).toBe('warn');
  });
});

describe('readLatestBackupLog', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-logs-'));
    fs.writeFileSync(path.join(dir, 'backup-20260930.log'), 'old');
    fs.writeFileSync(path.join(dir, 'backup-20261001.log'), '\uFEFF' + OK_LOG); // ★ BOM 付きでも読む
    fs.writeFileSync(path.join(dir, 'robocopy-20261001.log'), 'robocopy');   // ★ 別の記録は拾わない
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('名前の日付がいちばん新しい backup-*.log を読む (BOM は外す)', () => {
    const r = readLatestBackupLog(dir);
    expect(r.latest?.name).toBe('backup-20261001.log');
    expect(r.latest?.content.startsWith('2026-10-01')).toBe(true);
  });

  it('★ 置き場が無ければ例外でなく readError を返す', () => {
    const r = readLatestBackupLog(path.join(dir, 'nope'));
    expect(r.latest).toBeNull();
    expect(r.readError).toBeTruthy();
  });
});

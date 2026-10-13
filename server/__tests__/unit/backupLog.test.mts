/**
 * バックアップの記録の判定 (#595)
 *
 * ★ 見張り (docs/09) と agent-server の doctor が**同じ判定を使う**ために、本体側へ移したもの。
 *   同じ判定を 2 か所に書くと、片方だけ直して食い違う。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessBackup, readLatestBackupLog, BACKUP_STALE_HOURS } from '../../src/services/backupLog.mts';

const NOW = new Date('2026-10-13T12:00:00+09:00');
const OK = '2026-10-13 03:00:02 DB ok\n2026-10-13 03:00:25 === 終了: 成功 ===\n';
const log = (name: string, content: string, mtime: string) => ({ name, content, mtime: new Date(mtime) });

describe('assessBackup', () => {
  it('今朝の記録に成功の印があれば ok。何時間前かを持つ', () => {
    const a = assessBackup({ latest: log('backup-20261013.log', OK, '2026-10-13T03:00:25+09:00') }, NOW);
    expect(a).toEqual({ kind: 'ok', name: 'backup-20261013.log', hours: 8 });
  });

  it('成功の印が無ければ bad。理由に「終了: 成功」が無いことを書く', () => {
    const a = assessBackup({ latest: log('backup-20261013.log', '2026-10-13 03:00:02 DB 失敗\n', '2026-10-13T03:00:25+09:00') }, NOW);
    expect(a.kind).toBe('bad');
    expect(a.kind === 'bad' && a.why).toContain('終了: 成功');
  });

  it(`${BACKUP_STALE_HOURS} 時間より古ければ bad (1 回飛んだ)`, () => {
    const a = assessBackup({ latest: log('backup-20261011.log', OK, '2026-10-11T03:00:25+09:00') }, NOW);
    expect(a.kind).toBe('bad');
    expect(a.kind === 'bad' && a.why).toContain(`${BACKUP_STALE_HOURS} 時間より古い`);
    expect(a.kind === 'bad' && a.hours).toBe(56);
  });

  it('読めなければ read-error、記録が無ければ none (★ 成功と言わない)', () => {
    expect(assessBackup({ latest: null, readError: 'ENOENT' }, NOW)).toEqual({ kind: 'read-error', error: 'ENOENT' });
    expect(assessBackup({ latest: null }, NOW)).toEqual({ kind: 'none' });
  });
});

describe('readLatestBackupLog', () => {
  it('名前の日付がいちばん新しい記録を読む。BOM を落とす', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
    fs.writeFileSync(path.join(dir, 'backup-20261012.log'), 'old');
    fs.writeFileSync(path.join(dir, 'backup-20261013.log'), '﻿' + OK);
    fs.writeFileSync(path.join(dir, 'robocopy-20261014.log'), 'x');
    const r = readLatestBackupLog(dir);
    expect(r.latest?.name).toBe('backup-20261013.log');
    expect(r.latest?.content.startsWith('2026')).toBe(true);
  });

  it('置き場が無ければ例外を投げず readError を返す', () => {
    const r = readLatestBackupLog(path.join(os.tmpdir(), 'no-such-dir-595'));
    expect(r.latest).toBeNull();
    expect(r.readError).toBeTruthy();
  });
});

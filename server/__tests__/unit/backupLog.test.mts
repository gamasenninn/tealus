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

  it('★ 同じ日に 2 回流して後の回が失敗したら bad (記録は同じファイルに追記される。最後の「終了」の行で決める)', () => {
    const twice = OK + '2026-10-13 15:47:18 === 開始 ===\n2026-10-13 15:47:18 メディア失敗: x\n2026-10-13 15:47:18 === 終了: ★ 失敗あり ===\n';
    expect(assessBackup({ latest: log('backup-20261013.log', twice, '2026-10-13T15:47:18+09:00') }, NOW).kind).toBe('bad');
    const thenOk = twice + '2026-10-13 16:00:00 === 開始 ===\n2026-10-13 16:00:30 === 終了: 成功 ===\n';
    expect(assessBackup({ latest: log('backup-20261013.log', thenOk, '2026-10-13T16:00:30+09:00') }, NOW).kind).toBe('ok');
  });

  it('★ 開始したまま終わっていない (途中で止まった) なら bad', () => {
    const cut = OK + '2026-10-13 15:47:18 === 開始 ===\n2026-10-13 15:47:20 DB ok\n';
    expect(assessBackup({ latest: log('backup-20261013.log', cut, '2026-10-13T15:47:20+09:00') }, NOW).kind).toBe('bad');
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
  it('名前の日付がいちばん新しい記録を読む。BOM を落とす', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
    fs.writeFileSync(path.join(dir, 'backup-20261012.log'), 'old');
    fs.writeFileSync(path.join(dir, 'backup-20261013.log'), '﻿' + OK);
    fs.writeFileSync(path.join(dir, 'robocopy-20261014.log'), 'x');
    const r = await readLatestBackupLog(dir);
    expect(r.latest?.name).toBe('backup-20261013.log');
    expect(r.latest?.content.startsWith('2026')).toBe(true);
  });

  it('置き場が無ければ例外を投げず readError を返す', async () => {
    const r = await readLatestBackupLog(path.join(os.tmpdir(), 'no-such-dir-595'));
    expect(r.latest).toBeNull();
    expect(r.readError).toBeTruthy();
  });

  // ★ 改善ループ 10 回目の D (2026-10-23): 置き場は NAS (UNC)。以前は同期で読んでいて、
  //   NAS が応答しないと本体の全部 (チャット・通知) が止まる形だった。非同期にして、時間で切る
  it('★ 置き場が応答しなければ、時間で切って readError を返す (待ち続けない)', async () => {
    const never = { readdir: () => new Promise<string[]>(() => {}), readFile: jest.fn(), stat: jest.fn() };
    const t0 = Date.now();
    const r = await readLatestBackupLog('\\nas\bak', { fs: never, timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.latest).toBeNull();
    expect(r.readError).toContain('応答');
  });

  it('★ 前の読み取りがまだ終わっていなければ、重ねて読まない (固まった NAS に読み取りを積まない)', async () => {
    let calls = 0;
    const never = { readdir: () => { calls++; return new Promise<string[]>(() => {}); }, readFile: jest.fn(), stat: jest.fn() };
    await readLatestBackupLog('\\nas\stuck', { fs: never, timeoutMs: 20 });
    const second = await readLatestBackupLog('\\nas\stuck', { fs: never, timeoutMs: 20 });
    expect(calls).toBe(1);
    expect(second.readError).toContain('前回');
  });

  // ★ 改善ループ 12 回目: 裏の読み取りが永久に戻らないと「読み取り中」の印も永久に残り、NAS が戻っても再起動まで ok に戻らなかった
  it('★ 前の読み取りが固まったまま 15 分を過ぎたら、次の読み取りを許す', async () => {
    let calls = 0;
    const never = { readdir: () => { calls++; return new Promise<string[]>(() => {}); }, readFile: jest.fn(), stat: jest.fn() };
    const t = Date.now();
    await readLatestBackupLog('\\nas\stale', { fs: never, timeoutMs: 10, now: () => t });
    await readLatestBackupLog('\\nas\stale', { fs: never, timeoutMs: 10, now: () => t + 14 * 60_000 });
    expect(calls).toBe(1);
    await readLatestBackupLog('\\nas\stale', { fs: never, timeoutMs: 10, now: () => t + 16 * 60_000 });
    expect(calls).toBe(2);
  });
});

/**
 * #438 / #419 — workspace の資格情報走査を doctor から呼べる形にする。
 *
 * ★ 2026-09-06 に採用者が踏んだ 3 件目。★★ 当時は「残存 0 件」と報告して外したが、
 *   **走査が 1 階層しか見ていなかった** (`workspace/*` だけを見て `.codex_home/` の中を
 *   見ていなかった)。★★★ なので **隠しディレクトリを含めて全深さ**を歩くこと。
 *   ripgrep / grep -r は既定で dot-dir を飛ばすので使わない。
 *
 * ★★★★ **値は絶対に出さない。** 出すのは「どのファイルに、どの種類が」だけ。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanWorkspaceSecrets } from '../../scripts/scan-workspace-secrets.mts';

function tmpTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-scan-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body, 'utf8');
  }
  return root;
}

describe('#419 workspace 走査', () => {
  const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz123456';

  it('★ 隠しディレクトリの中も見る (2026-09-06 の見落としがここ)', () => {
    const root = tmpTree({
      'agent1/room1/.codex_home/auth.json': `{"OPENAI_API_KEY":"${SECRET}"}`,
      'agent1/room1/notes.md': 'ふつうのメモ',
    });
    const r = scanWorkspaceSecrets(root);
    expect(r.hits.map((h) => h.file.replace(/\\/g, '/'))).toContain(
      'agent1/room1/.codex_home/auth.json',
    );
  });

  it('★★ 値を 1 文字も返さない (種類と場所だけ)', () => {
    const root = tmpTree({ 'agent1/room1/.env': `OPENAI_API_KEY=${SECRET}` });
    const all = JSON.stringify(scanWorkspaceSecrets(root));
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('abcdefghij');
    expect(all).toContain('OPENAI_API_KEY'); // ★ 種類は出す
  });

  it('`_` で始まる directory は workspace の外なので対象外', () => {
    const root = tmpTree({ '_internal/room1/.env': `OPENAI_API_KEY=${SECRET}` });
    expect(scanWorkspaceSecrets(root).hits).toEqual([]);
  });

  it('★ コードが workspace に書き戻すものを数える', () => {
    const root = tmpTree({ 'agent1/room1/.codex_home/x.txt': 'ok' });
    expect(scanWorkspaceSecrets(root).backAgain).toBeGreaterThan(0);
  });

  it('読めない root でも落ちない (★ 診断は止めない)', () => {
    const r = scanWorkspaceSecrets(path.join(os.tmpdir(), 'does-not-exist-' + Date.now()));
    expect(r.hits).toEqual([]);
    expect(r.scanned).toBe(0);
  });
});

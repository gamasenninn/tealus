/**
 * Light v2 の会話の記録 (codex の rollout) を、利用者のホームの .codex から部屋ごとの置き場へ移す (2026-10-27 小野さん判断、承認 12)
 *
 * ★ Light v2 は codex SDK で動き、CODEX_HOME を切り替えていないので、記録 (本文・画像の base64 入り) が
 *   ~/.codex/sessions に溜まっていた。Deep は #419 で `_codex-homes/<agentId>/<roomId>` に出している。
 * ★ CODEX_HOME ごと切り替えないのは、Light v2 は部屋ごとに並んで走り、認証のファイルを部屋ごとに写すと
 *   更新された鍵が写し同士でぶつかる (refresh_token_reused) ため。走り終えたその回の記録だけを、会話の ID で移す
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

import { moveCodexRollout } from '../../src/lib/codexRollout.mts';

let root: string;
let codexHome: string;
let dest: string;
const TID = '01a17af0-82e7-7541-9b53-5d715e9ab3fc';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-rollout-'));
  codexHome = path.join(root, '.codex');
  dest = path.join(root, '_codex-homes', 'agent-1', 'room-1');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function put(day: string, name: string) {
  const dir = path.join(codexHome, 'sessions', ...day.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), '{}');
  return path.join(dir, name);
}

describe('moveCodexRollout', () => {
  test('★★ その会話の記録を、部屋の置き場の sessions へ移す (元には残さない)', () => {
    const src = put('2026/10/27', `rollout-2026-10-27T10-19-04-${TID}.jsonl`);
    const moved = moveCodexRollout(TID, dest, { codexHome, now: new Date(2026, 9, 27, 10, 20) });
    expect(moved).toBe(path.join(dest, 'sessions', `rollout-2026-10-27T10-19-04-${TID}.jsonl`));
    expect(fs.existsSync(moved!)).toBe(true);
    expect(fs.existsSync(src)).toBe(false);
  });

  test('★ ほかの会話の記録には触らない (同じ機械の別の codex の分)', () => {
    const other = put('2026/10/27', 'rollout-2026-10-27T10-17-56-01a17aef-6abf-7830-a8c7-0f270df8f853.jsonl');
    put('2026/10/27', `rollout-2026-10-27T10-19-04-${TID}.jsonl`);
    moveCodexRollout(TID, dest, { codexHome, now: new Date(2026, 9, 27, 10, 20) });
    expect(fs.existsSync(other)).toBe(true);
  });

  test('日付をまたいだ回 (始まりが前の日) も見つける', () => {
    put('2026/10/26', `rollout-2026-10-26T23-59-50-${TID}.jsonl`);
    expect(moveCodexRollout(TID, dest, { codexHome, now: new Date(2026, 9, 27, 0, 1) })).not.toBeNull();
  });

  test('見つからない・ID が無いときは何もしない (例外を出さない)', () => {
    expect(moveCodexRollout(TID, dest, { codexHome, now: new Date(2026, 9, 27) })).toBeNull();
    expect(moveCodexRollout(null, dest, { codexHome })).toBeNull();
    expect(moveCodexRollout('../x', dest, { codexHome })).toBeNull();   // ID の形でなければ探さない
  });
});

/**
 * 班ごとのカーソル (最後に受け付けられた便の id) (docs/12 §8 の 5・§12.3)。
 * ★ 置き場は ~/.tealus/courier/ (cc-queue のフォルダには書かない。あそこは agent-server の持ち物)
 * ★ 一時ファイルに書いて rename で入れ替える。書けてから進んだことになる
 */
import fs from 'node:fs';
import path from 'node:path';
import { QUEUE_ID_RE } from './queue.mts';

/** project 名はファイル名になるので形を確かめる (docs/12 §12.3) */
const PROJECT_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export function isValidProject(p: string): boolean { return PROJECT_RE.test(p); }

function cursorPath(dir: string, project: string): string {
  if (!isValidProject(project)) throw new Error(`project 名の形が違います: ${JSON.stringify(project)}`);
  return path.join(dir, `cursor-${project}.json`);
}

export function loadCursor(dir: string, project: string): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(cursorPath(dir, project), 'utf8')) as { id?: unknown };
    return typeof v.id === 'string' && QUEUE_ID_RE.test(v.id) ? v.id : null;
  } catch {
    return null;   // 無い・壊れている → 初回と同じく末尾から
  }
}

export function saveCursor(dir: string, project: string, id: string): void {
  const p = cursorPath(dir, project);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ id, at: new Date().toISOString() }));
  fs.renameSync(tmp, p);
}

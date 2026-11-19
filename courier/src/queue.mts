/**
 * cc-queue (~/.tealus/cc-queue/<project>.jsonl) を読む部分 (docs/12 §4・§12.2)。
 *
 * ★ 開きっぱなしにしない。毎回全部読んで閉じる (最大 2,000 行)。agent-server の切り詰めは一時ファイルを
 *   rename で入れ替えるので、Windows で開いたままだと rename が失敗しうる
 * ★ 返すのは id だけ。本文は読まない・返さない (配達役は本文を渡さない。docs/12 §8 の 1)
 * ★ 読めない・空・書きかけの行は「まだ無い」として扱う (新着ともカーソルの消失ともみなさない)
 */
import fs from 'node:fs';

/** docs/12 §4.1 の id の形 (Tealus のメッセージの UUID)。agent-server の ccQueueLineContract.test.mts と同じ写し */
export const QUEUE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type QueueRead = { ok: true; ids: string[]; bad: number } | { ok: false; reason: string };

export function readQueue(filePath: string): QueueRead {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');   // 開いて読んで閉じる (開きっぱなしにしない)
  } catch (err) {
    return { ok: false, reason: (err as NodeJS.ErrnoException).code || 'read-failed' };
  }
  if (text.length === 0) return { ok: false, reason: 'empty' };
  // ★ 末尾が改行で終わらない最後の行は書きかけ。次の回に読み直す
  const complete = text.endsWith('\n') ? text : text.slice(0, text.lastIndexOf('\n') + 1);
  const ids: string[] = [];
  let bad = 0;
  for (const l of complete.split('\n')) {
    if (!l.trim()) continue;
    let v: unknown;
    try { v = JSON.parse(l); } catch { bad++; continue; }
    const id = (v as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && QUEUE_ID_RE.test(id)) ids.push(id);
    else bad++;
  }
  return { ok: true, ids, bad };
}

/**
 * カーソルの後ろの新着。
 * - カーソルが無い (初回) は末尾から始める (過去分は流さない。listen-tealus の tail -n 0 と同じ)
 * - 同じ id が 2 回入っていたら、最後に出てきた位置で探す (編集で宛名を付け直した便)
 * - カーソルが消えていたら (切り詰め)、残りを全部新着にして lost を立てる (呼び手は件数を数えず「新着あり」にする)
 */
export function newSince(ids: string[], cursor: string | null): { ids: string[]; last: string | null; lost: boolean } {
  const last = ids.length ? ids[ids.length - 1] : cursor;
  if (cursor === null) return { ids: [], last, lost: false };
  const at = ids.lastIndexOf(cursor);
  if (at >= 0) return { ids: ids.slice(at + 1), last, lost: false };
  return { ids: [...ids], last, lost: true };
}

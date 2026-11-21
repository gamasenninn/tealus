/**
 * 段階 3: 相手の PC が HTTP で便を取りに来る (docs/12 §14、2026-11-21 利用者「HTTP 版を作ってから移す」)。
 *
 * agent-server の `GET /agent-api/cc-queue/pending?project=X&events=1[&since=写しの最後]` で取り、
 * id だけを手元の写し `<dir>/<班>.jsonl` に足す。配る輪 (tick) は写しのファイルを今までどおり読む (配る判断を 2 つ書かない)。
 *
 * ★ since が queue に無い (切り詰め) と agent-server は残り全部を返す → 写しに既にある id は足さない (§14.2)
 * ★ 写すのは {"id"} だけ。本文・部屋・送り主は書かない (§8 の 1)
 * ★ 取れないときは写しを触らない。投げない
 */
import fs from 'node:fs';
import path from 'node:path';
import { authClient, type CourierAuth, type FetchLike } from './authClient.mts';
import { readQueue, QUEUE_ID_RE } from './queue.mts';

/** queue と同じ上限 (docs/12 §4) */
export const MIRROR_MAX_LINES = 2_000;

export type MirrorResult = { ok: true; added: number } | { ok: false; reason: string };

export function httpQueueMirror(auth: CourierAuth, fetchImpl?: FetchLike) {
  const call = authClient(auth, fetchImpl);
  return async function mirror(project: string, dir: string): Promise<MirrorResult> {
    const file = path.join(dir, `${project}.jsonl`);
    const have = readQueue(file);
    const ids = have.ok ? have.ids : [];
    const since = ids.at(-1);
    const q = `project=${encodeURIComponent(project)}&events=1${since ? `&since=${since}` : ''}`;
    const r = await call('GET', `/agent-api/cc-queue/pending?${q}`);
    if (r.status !== 200) return { ok: false, reason: r.error ?? `pending が ${r.status} を返しました` };
    const events = (r.body as { events?: unknown } | null)?.events;
    if (!Array.isArray(events)) return { ok: false, reason: 'pending の返事に events がありません (agent-server が古い?)' };

    const seen = new Set(ids);
    const add: string[] = [];
    for (const e of events) {
      const eid = (e as { id?: unknown } | null)?.id;
      if (typeof eid !== 'string' || !QUEUE_ID_RE.test(eid) || seen.has(eid)) continue;
      seen.add(eid);
      add.push(eid);
    }
    // ★ 一度も便が無い班でも、取れたら空の写しを作る。写しが無い間は配る輪が「まだ取り寄せていない」と見て待つ (tick)
    if (add.length === 0) {
      if (!have.ok && have.reason === 'ENOENT') { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, ''); }
      return { ok: true, added: 0 };
    }

    const all = [...ids, ...add].slice(-MIRROR_MAX_LINES);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, all.map((x) => JSON.stringify({ id: x }) + '\n').join(''));
    fs.renameSync(tmp, file);   // ★ 書きかけを配る輪に読ませない
    return { ok: true, added: add.length };
  };
}

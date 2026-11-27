/**
 * タスク一覧 (docs/16、#661) の読み書き。本人の口 (routes/tasks.mts の router) と AI の口 (botRouter) の共通の中身。
 * ★ 一覧は人のもの (owner_id)。部屋は括り。括りの部屋と元の投稿は、owner が入っている部屋のものだけ
 * ★ 済みにするのは人。AI の口は status を変えられない (§4.3) — 口の側で断る。ここは渡された値をそのまま書く
 * ★ 保留は区分の 5 つ目 (051、§8-7)。入れたら held_at に時刻、出したら消す。状態の held はやめた (status=held の絞りは区分で絞る)
 */
import pg from 'pg';
import { pool } from '../db/pool.mts';
import { isUuid } from '../utils/uuid.mts';

export const TASK_SECTIONS = ['decide', 'do', 'waiting', 'later', 'held'] as const;
export const TASK_STATUSES = ['open', 'done'] as const;
/** 一覧の絞り。'held' は前の版の道具 (MCP の list_tasks) が使う名前のまま、区分が保留の残りで絞る */
const LIST_FILTERS = ['open', 'done', 'held', 'all', 'remaining'] as const;
export type TaskSection = (typeof TASK_SECTIONS)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskRow {
  id: string;
  owner_id: string;
  /** 会社全体の通し番号 (049)。タスクの ID。済みにしても・持ち主が変わっても変わらない */
  number: number;
  room_id: string | null;
  room_name: string | null;
  title: string;
  note: string | null;
  section: TaskSection;
  status: TaskStatus;
  source_message_ids: string[];
  ai_suggests_done: boolean;
  created_by: string | null;
  done_at: Date | null;
  done_by: string | null;
  sort_order: number;
  /** 期限 (050、日付だけ)。'YYYY-MM-DD' の字のまま返す。NULL = 期限なし */
  due_date: string | null;
  /** 保留にした時刻 (051)。区分が held のときだけ入る */
  held_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** 書き込みの入力の誤り (口で 400 / 403 にする) */
export class TaskInputError extends Error {
  readonly status: 400 | 403;
  constructor(message: string, status: 400 | 403) { super(message); this.status = status; }
}

const SELECT = `SELECT t.*, r.name AS room_name FROM tasks t LEFT JOIN rooms r ON r.id = t.room_id`;
/** 部屋 (名前順、部屋なしは最後) → 区分 → 並び → 古い順 */
const ORDER = `ORDER BY (t.room_id IS NULL), r.name, t.room_id,
  array_position(ARRAY['decide','do','waiting','later','held']::varchar[], t.section), t.sort_order, t.created_at`;

/**
 * ★ DATE (oid 1082) は pg の既定だと「この機械の時間帯の 0 時」の Date になり、JSON で UTC に直すと日本では前の日になる。
 *   この表の読みだけ字のまま受ける (pool 全体の既定は変えない: 他の DATE 列の読み手に響くため)
 */
const DATE_OID = 1082;
const types = { getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
  oid === DATE_OID ? (v: string) => v : pg.types.getTypeParser(oid, format as 'text')) as typeof pg.types.getTypeParser };
const query = <R extends pg.QueryResultRow>(text: string, values: unknown[]) => pool.query<R>({ text, values, types });

export async function listTasks(ownerId: string, opts: { status?: string; roomId?: string } = {}): Promise<TaskRow[]> {
  const params: unknown[] = [ownerId];
  const where = ['t.owner_id = $1'];
  const status = opts.status || 'remaining';
  if (!(LIST_FILTERS as readonly string[]).includes(status)) throw new TaskInputError('status は open / done / held / all のどれかです', 400);
  if (status === 'remaining') where.push(`t.status = 'open'`);
  else if (status === 'held') where.push(`t.status = 'open'`, `t.section = 'held'`);
  else if (status !== 'all') { params.push(status); where.push(`t.status = $${params.length}`); }
  if (opts.roomId) {
    if (!isUuid(opts.roomId)) throw new TaskInputError('room_id が ID の形ではありません', 400);
    params.push(opts.roomId); where.push(`t.room_id = $${params.length}`);
  }
  const { rows } = await query<TaskRow>(`${SELECT} WHERE ${where.join(' AND ')} ${ORDER}`, params);
  return rows;
}

export async function getTask(id: string, ownerId: string): Promise<TaskRow | null> {
  if (!isUuid(id)) return null;
  const { rows } = await query<TaskRow>(`${SELECT} WHERE t.id = $1 AND t.owner_id = $2`, [id, ownerId]);
  return rows[0] ?? null;
}

/** 括りの部屋と元の投稿が、owner の入っている部屋のものか */
async function checkScope(ownerId: string, roomId: string | null | undefined, messageIds: string[] | undefined): Promise<void> {
  if (roomId) {
    if (!isUuid(roomId)) throw new TaskInputError('room_id が ID の形ではありません', 400);
    const r = await pool.query('SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, ownerId]);
    if (r.rows.length === 0) throw new TaskInputError('入っていない部屋は括りにできません', 403);
  }
  if (messageIds && messageIds.length > 0) {
    if (!messageIds.every(isUuid)) throw new TaskInputError('source_message_ids に ID の形でないものがあります', 400);
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM messages m JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $2
        WHERE m.id = ANY($1::uuid[])`, [messageIds, ownerId]);
    if (r.rows[0].n !== new Set(messageIds).size) throw new TaskInputError('入っていない部屋の投稿は付けられません', 403);
  }
}

/** 'YYYY-MM-DD' で、暦にある日か (2026-02-30 などは断る) */
function isDateOnly(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function checkFields(f: { title?: unknown; section?: unknown; status?: unknown; note?: unknown; sort_order?: unknown; source_message_ids?: unknown; due_date?: unknown }, creating: boolean): void {
  if (creating || f.title !== undefined) {
    if (typeof f.title !== 'string' || f.title.trim() === '') throw new TaskInputError('題 (title) が要ります', 400);
  }
  if (f.section !== undefined && !(TASK_SECTIONS as readonly unknown[]).includes(f.section)) throw new TaskInputError('section は decide / do / waiting / later / held のどれかです', 400);
  if (f.status === 'held') throw new TaskInputError('保留は区分 (section: held) で付けます (状態の held はやめました)', 400);
  if (f.status !== undefined && !(TASK_STATUSES as readonly unknown[]).includes(f.status)) throw new TaskInputError('status は open / done のどれかです', 400);
  if (f.note !== undefined && f.note !== null && typeof f.note !== 'string') throw new TaskInputError('note は文字です', 400);
  if (f.sort_order !== undefined && !Number.isInteger(f.sort_order)) throw new TaskInputError('sort_order は整数です', 400);
  if (f.source_message_ids !== undefined && !Array.isArray(f.source_message_ids)) throw new TaskInputError('source_message_ids は配列です', 400);
  if (f.due_date !== undefined && f.due_date !== null && (typeof f.due_date !== 'string' || !isDateOnly(f.due_date))) {
    throw new TaskInputError('due_date は YYYY-MM-DD の日付か null です', 400);
  }
}

export interface NewTask {
  title: string; note?: string | null; section?: TaskSection; room_id?: string | null; source_message_ids?: string[]; sort_order?: number; due_date?: string | null;
}

export async function createTask(ownerId: string, createdBy: string, input: Record<string, unknown>): Promise<TaskRow> {
  checkFields(input, true);
  const t = input as unknown as NewTask;
  await checkScope(ownerId, t.room_id, t.source_message_ids);
  const params = [ownerId, createdBy, t.title.trim(), t.note ?? null, t.section ?? 'do', t.room_id ?? null, [...new Set(t.source_message_ids ?? [])], t.sort_order ?? 0, t.due_date ?? null];
  // ★ 番号は列の既定 (tasks_number_seq、049) が振る。会社全体の通し番号で、消した番号は使い回さない
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tasks (owner_id, created_by, title, note, section, room_id, source_message_ids, sort_order, due_date, held_at)
     VALUES ($1, $2, $3, $4, $5::varchar, $6, $7::uuid[], $8, $9::date, CASE WHEN $5::varchar = 'held' THEN now() END) RETURNING id`, params);
  return (await getTask(rows[0].id, ownerId))!;
}

const EDITABLE = ['title', 'note', 'section', 'status', 'room_id', 'source_message_ids', 'sort_order', 'ai_suggests_done', 'due_date'] as const;

/** 直す。見つからない (他人のもの) なら null。done にすると時刻と人を入れ AI の印を下ろす。done から戻すと消す */
export async function updateTask(id: string, ownerId: string, actorId: string, patch: Record<string, unknown>): Promise<TaskRow | null> {
  const cur = await getTask(id, ownerId);
  if (!cur) return null;
  checkFields(patch, false);
  if (patch.ai_suggests_done !== undefined && typeof patch.ai_suggests_done !== 'boolean') throw new TaskInputError('ai_suggests_done は true / false です', 400);
  if (patch.number !== undefined) throw new TaskInputError('番号は変えられません', 400);
  await checkScope(ownerId, patch.room_id as string | null | undefined, patch.source_message_ids as string[] | undefined);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col} = $${params.length}${cast}`); };
  for (const k of EDITABLE) {
    if (patch[k] === undefined) continue;
    if (k === 'title') set(k, (patch[k] as string).trim());
    else if (k === 'source_message_ids') set(k, [...new Set(patch[k] as string[])], '::uuid[]');
    else if (k === 'due_date') set(k, patch[k], '::date');
    else set(k, patch[k]);
  }
  if (patch.status === 'done' && cur.status !== 'done') {
    set('done_by', actorId); sets.push('done_at = now()');
    if (patch.ai_suggests_done === undefined) set('ai_suggests_done', false);
  } else if (patch.status !== undefined && patch.status !== 'done' && cur.status === 'done') {
    sets.push('done_at = NULL', 'done_by = NULL');
  }
  // 保留に入れたら時刻を入れ、出したら消す (保留のまま直しても時刻は変えない)
  if (patch.section === 'held' && cur.section !== 'held') sets.push('held_at = now()');
  else if (patch.section !== undefined && patch.section !== 'held' && cur.section === 'held') sets.push('held_at = NULL');
  if (sets.length === 0) return cur;
  sets.push('updated_at = now()');
  params.push(id, ownerId);
  await pool.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND owner_id = $${params.length}`, params);
  return getTask(id, ownerId);
}

export async function deleteTask(id: string, ownerId: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await pool.query('DELETE FROM tasks WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  return (r.rowCount ?? 0) > 0;
}

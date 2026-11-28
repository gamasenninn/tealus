/**
 * タスク一覧 (docs/16、#661)。会話から AI がまとめた「自分のやること」を 1 枚で見る。
 * ★ 部屋の見出し → 区分 (決める / 手を動かす / 待ち / 今日でなくてよい) → 1 件 1 行
 * ★ 済みにするのは本人 (□)。AI の「済んだようです」は印で、押せば済み (docs/16 §4.3)
 * ★ 印刷は「いま画面で絞っているもの」をそのまま (2026-11-26 利用者の案)。印刷用の見た目は TaskPage.css の @media print
 * ★ マルチトークの右の帯 (§5.1) では embedded: 「戻る」「印刷」を出さず、「元の会話」は画面を移らずに onOpenSource へ渡す (パネルで開く)
 * ★ 説明をたたむ (11-28 利用者の案): 見出しの切り替えで全部たたむ / 出す (端末で覚える)。たたんでいる間は題名を押すとその 1 件だけ開く (覚えない)。
 *   期限・保留の印と「AI: 済んだようです」はたたんでも出す。印刷は画面のとおり
 * ★ 保留 (11-28、§8-7): 区分の 5 つ目で部屋の最後。題名だけ薄く・「保留 11/28〜」・見出しの残りの数に入れない (隠しはしない)
 * ★ 期限 (タスク 33、§8-6): 題の後ろに〆月/日・期限切れ / 今日までは字で (印刷で色が落ちても読める)。並べ替えない。各行の「直す」で題・ひとこと・区分・期限
 * ★ 部屋 (11-28 採用者の知らせ): 上で部屋を絞っているときに足したら、その部屋に入れる。「直す」で部屋も変えられる (選べるのは自分が入っている部屋)。
 *   元の会話つきのタスクの部屋を変えたら、元の会話へのつなぎは外す (つないだままだと「元の会話」が別の部屋へ飛ぶ)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Printer, Plus, ChevronsDownUp, ChevronsUpDown, ChevronRight } from 'lucide-react';
import { api } from '../../services/api';
import type { Task, TaskSection } from '../../types';
import { localToday, dueState, dueLabel, countOverdue } from '../../utils/taskDue';
import './TaskPage.css';

const SECTIONS: { key: TaskSection; label: string }[] = [
  { key: 'decide', label: '決める' },
  { key: 'do', label: '手を動かす' },
  { key: 'waiting', label: '待ち' },
  { key: 'later', label: '今日でなくてよい' },
  { key: 'held', label: '保留' },
];
const STATUS_FILTERS: { key: string | undefined; label: string }[] = [
  { key: undefined, label: '残り' },
  { key: 'done', label: '済み' },
  { key: 'held', label: '保留' },
  { key: 'all', label: 'すべて' },
];
const NO_ROOM = '__none__';
const FOLD_KEY = 'taskNotesFolded';
const readFolded = () => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } };
const writeFolded = (v: boolean) => { try { localStorage.setItem(FOLD_KEY, v ? '1' : '0'); } catch { /* 覚えられなくても画面は動く */ } };

interface Group { key: string; name: string; tasks: Task[] }
interface Draft { title: string; note: string; section: TaskSection; due: string; room: string }
interface RoomOption { id: string; name: string }

/** 作った日 (月/日)。番号は会社全体の通し番号なので、いつのものかは横に添える (docs/16 §8-5、11-26 利用者) */
const madeOn = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

/** 本体が返した順 (部屋名 → 部屋なしは最後 → 区分 → 並び) のまま、部屋ごとに束ねる */
function groupByRoom(tasks: Task[]): Group[] {
  const groups: Group[] = [];
  for (const t of tasks) {
    const key = t.room_id ?? NO_ROOM;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, name: t.room_id ? (t.room_name ?? '(消した部屋)') : '部屋なし', tasks: [] }; groups.push(g); }
    g.tasks.push(t);
  }
  return groups;
}

interface TaskPageProps {
  /** docs/16 §5.1 マルチトークの右の帯の中 */
  embedded?: boolean;
  /** 帯の「元の会話」: 画面を移らずに、部屋と発言を渡す (マルチトークがパネルで開く) */
  onOpenSource?: (src: { id: string; name: string; msgId: string }) => void;
}

function TaskPage({ embedded = false, onOpenSource }: TaskPageProps = {}) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [room, setRoom] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSection, setNewSection] = useState<TaskSection>('do');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ title: '', note: '', section: 'do', due: '', room: '' });
  const [myRooms, setMyRooms] = useState<RoomOption[] | null>(null);
  const [folded, setFolded] = useState(readFolded);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const toggleFolded = () => { const v = !folded; setFolded(v); writeFolded(v); setOpened(new Set()); };
  const toggleOpened = (id: string) => setOpened((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const load = useCallback(async (s: string | undefined) => {
    setLoading(true);
    try {
      const data = await api.listTasks(s ? { status: s } : {});
      setTasks(data.tasks || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(status); }, [load, status]);

  // タスク 32: AI が足したものは開き直さないと出なかった。今の絞りのまま引き直し、引いている間も一覧は消さない
  const reload = async () => {
    setReloading(true);
    try {
      const data = await api.listTasks(status ? { status } : {});
      setTasks(data.tasks || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloading(false);
    }
  };

  const rooms = useMemo(() => groupByRoom(tasks).map((g) => ({ key: g.key, name: g.name })), [tasks]);
  // 足す先: 部屋を 1 つに絞っているときはその部屋 (「部屋なし」・全部のときは部屋なし)
  const addRoom = room && room !== NO_ROOM ? rooms.find((r) => r.key === room) ?? null : null;
  const shown = useMemo(() => groupByRoom(room ? tasks.filter((t) => (t.room_id ?? NO_ROOM) === room) : tasks), [tasks, room]);

  const setDone = async (t: Task, done: boolean) => {
    const next = done ? 'done' : 'open';
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, status: next, ai_suggests_done: done ? false : x.ai_suggests_done } : x)));
    try {
      await api.updateTask(t.id, { status: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      load(status);
    }
  };

  const add = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      await api.addTask({ title, section: newSection, room_id: addRoom ? addRoom.key : null });
      setNewTitle(''); setAdding(false);
      load(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startEdit = (t: Task) => {
    setDraft({ title: t.title, note: t.note ?? '', section: t.section, due: t.due_date ?? '', room: t.room_id ?? '' });
    setEditing(t.id);
    // 部屋の選択肢は、はじめて「直す」を開いたときに 1 回だけ引く
    if (myRooms === null) {
      api.getRooms()
        .then((d) => setMyRooms((d.rooms || []).map((r) => ({ id: r.id, name: r.name || r.partner_display_name || '1 対 1' }))))
        .catch((err) => { setMyRooms([]); setError(err instanceof Error ? err.message : String(err)); });
    }
  };
  /** 「直す」の部屋の選択肢。今の部屋が一覧に無くても (抜けた部屋など) 残す */
  const roomOptions = (t: Task): RoomOption[] => {
    const list = myRooms ?? [];
    return t.room_id && !list.some((r) => r.id === t.room_id) ? [...list, { id: t.room_id, name: t.room_name ?? '(消した部屋)' }] : list;
  };

  // タスク 33 「直す」: 題・ひとこと・区分・期限をその場で。期限は空 (null) にもできる
  const saveEdit = async (t: Task) => {
    const title = draft.title.trim();
    if (!title) return;
    const fields: Parameters<typeof api.updateTask>[1] = { title, note: draft.note.trim() || null, section: draft.section, due_date: draft.due || null };
    if (draft.room !== (t.room_id ?? '')) {
      fields.room_id = draft.room || null;
      if (t.source_message_ids.length > 0) fields.source_message_ids = [];
    }
    try {
      const res = await api.updateTask(t.id, fields);
      setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...fields, ...(res?.task ?? {}) } as Task : x)));
      setEditing(null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // 保留は数えない (時間稼ぎが効くように。一覧には出す)
  const remaining = tasks.filter((t) => t.status !== 'done' && t.section !== 'held').length;
  const today = localToday();
  const overdue = countOverdue(tasks, today);
  return (
    <div className={embedded ? 'task-page embedded' : 'task-page'}>
      <header className="task-header no-print">
        {!embedded && <button className="task-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/talk'))} aria-label="戻る"><ArrowLeft size={22} /></button>}
        <h1>タスク{status === undefined && <span className="task-count">{remaining}</span>}
          {overdue > 0 && <span className="task-overdue-count" aria-label={`期限切れ ${overdue} 件`}>{overdue}</span>}
        </h1>
        <button className="task-fold" onClick={toggleFolded} aria-label={folded ? '説明を出す' : '説明をたたむ'} title={folded ? '説明を出す' : '説明をたたむ'}>
          {folded ? <ChevronsUpDown size={18} /> : <ChevronsDownUp size={18} />}
        </button>
        <button className={`task-reload ${reloading ? 'spinning' : ''}`} onClick={reload} disabled={reloading || loading} aria-label="読み直す" title="読み直す"><RefreshCw size={18} /></button>
        {!embedded && <button className="task-print" onClick={() => window.print()}><Printer size={18} /> 印刷</button>}
      </header>

      <h1 className="task-print-title print-only">
        タスク <span>{new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })} 時点</span>
      </h1>

      <div className="task-filters no-print">
        {STATUS_FILTERS.map((f) => (
          <button key={f.label} className={`task-chip ${status === f.key ? 'active' : ''}`} onClick={() => setStatus(f.key)}>{f.label}</button>
        ))}
        <label className="task-room-filter">
          <span className="sr-only">部屋</span>
          <select aria-label="部屋" value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">部屋: すべて</option>
            {rooms.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </label>
      </div>

      {error && <div className="task-error no-print">{error}</div>}

      {loading ? (
        <div className="task-empty">読み込み中...</div>
      ) : shown.length === 0 ? (
        <div className="task-empty">{status === undefined ? '残っているタスクはありません' : 'タスクはありません'}</div>
      ) : (
        shown.map((g) => (
          <section key={g.key} className="task-group" role="region" aria-label={g.name}>
            <h2 className="task-group-title"><span>{g.key === NO_ROOM ? g.name : `# ${g.name}`}</span><span className="task-group-count">{g.tasks.length} 件</span></h2>
            {SECTIONS.filter((s) => g.tasks.some((t) => t.section === s.key)).map((s) => (
              <div key={s.key} className="task-section">
                <div className={`task-section-label sec-${s.key}`}>{s.label}</div>
                {g.tasks.filter((t) => t.section === s.key).map((t) => (
                  <div key={t.id} className={`task-item ${t.status === 'done' ? 'done' : ''} ${t.section === 'held' ? 'held' : ''}`}>
                    <input
                      type="checkbox"
                      className="task-check"
                      aria-label={t.title}
                      checked={t.status === 'done'}
                      onChange={(e) => setDone(t, e.target.checked)}
                    />
                    {editing === t.id ? (
                    <form className="task-edit-form no-print" aria-label="直す" onSubmit={(e) => { e.preventDefault(); saveEdit(t); }}>
                      <label>題<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
                      <label>ひとこと<textarea rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
                      <div className="task-edit-row">
                        <label>区分
                          <select value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value as TaskSection })}>
                            {SECTIONS.map((s2) => <option key={s2.key} value={s2.key}>{s2.label}</option>)}
                          </select>
                        </label>
                        <label>期限<input type="date" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} /></label>
                        <button type="button" className="task-edit-clear" onClick={() => setDraft({ ...draft, due: '' })}>期限なし</button>
                      </div>
                      <div className="task-edit-row">
                        <label>部屋
                          <select value={draft.room} onChange={(e) => setDraft({ ...draft, room: e.target.value })}>
                            <option value="">部屋なし</option>
                            {roomOptions(t).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </label>
                      </div>
                      {draft.room !== (t.room_id ?? '') && t.source_message_ids.length > 0 && (
                        <p className="task-edit-warn">部屋を変えると、元の会話へのつなぎは外れます</p>
                      )}
                      <div className="task-edit-row">
                        <button type="submit" className="task-edit-save" disabled={!draft.title.trim()}>保存</button>
                        <button type="button" className="task-edit-cancel" onClick={() => setEditing(null)}>やめる</button>
                      </div>
                    </form>
                    ) : (
                    (() => {
                    const hasNote = !!(t.note || (t.room_id && t.source_message_ids.length > 0));
                    const noteShown = hasNote && (!folded || opened.has(t.id));
                    return (
                    <div className="task-body">
                      <div className="task-title">
                        {folded && hasNote && (
                          <button className={`task-note-toggle no-print ${noteShown ? 'open' : ''}`} onClick={() => toggleOpened(t.id)}
                            aria-expanded={noteShown} aria-label={`${noteShown ? '説明を閉じる' : '説明を開く'}: ${t.title}`}>
                            <ChevronRight size={16} />
                          </button>
                        )}
                        <span className="task-no">{t.number}</span>
                        <span className="task-date">{madeOn(t.created_at)}</span>
                        <span className="task-title-text">{t.title}</span>
                        {t.due_date && <span className="task-due">{dueLabel(t.due_date)}</span>}
                        {dueState(t, today) === 'overdue' && <span className="task-due-flag overdue">期限切れ</span>}
                        {dueState(t, today) === 'today' && <span className="task-due-flag today">今日まで</span>}
                        {t.section === 'held' && t.held_at && <span className="task-held">保留 {madeOn(t.held_at)}〜</span>}
                      </div>
                      {noteShown && (
                        <div className="task-note">
                          {t.note}
                          {t.room_id && t.source_message_ids.length > 0 && (
                            <button className="task-source no-print" onClick={() => {
                              const msgId = t.source_message_ids[0];
                              if (embedded && onOpenSource) onOpenSource({ id: t.room_id!, name: t.room_name ?? '', msgId });
                              else navigate(`/rooms/${t.room_id}?msg=${msgId}`);
                            }}>元の会話 ›</button>
                          )}
                        </div>
                      )}
                      {t.ai_suggests_done && t.status !== 'done' && (
                        <button className="task-ai-done" onClick={() => setDone(t, true)}>AI: 済んだようです ✓</button>
                      )}
                    </div>
                    );
                    })()
                    )}
                    {editing !== t.id && <button className="task-edit no-print" onClick={() => startEdit(t)}>直す</button>}
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))
      )}

      <div className="task-add no-print">
        {adding ? (
          <div className="task-add-form">
            {addRoom && <p className="task-add-room">{`# ${addRoom.name} に足します`}</p>}
            <input placeholder="やること" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <select aria-label="区分" value={newSection} onChange={(e) => setNewSection(e.target.value as TaskSection)}>
              {SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button className="task-add-ok" onClick={add}>追加</button>
            <button className="task-add-cancel" onClick={() => setAdding(false)}>やめる</button>
          </div>
        ) : (
          <button className="task-add-open" onClick={() => setAdding(true)}><Plus size={18} /> 足す</button>
        )}
        <p className="task-hint">AI が会話からまとめて足します。手でも足せます。</p>
      </div>
    </div>
  );
}

export default TaskPage;

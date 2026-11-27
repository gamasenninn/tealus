/**
 * タスク一覧 (docs/16、#661)。会話から AI がまとめた「自分のやること」を 1 枚で見る。
 * ★ 部屋の見出し → 区分 (決める / 手を動かす / 待ち / 今日でなくてよい) → 1 件 1 行
 * ★ 済みにするのは本人 (□)。AI の「済んだようです」は印で、押せば済み (docs/16 §4.3)
 * ★ 印刷は「いま画面で絞っているもの」をそのまま (2026-11-26 利用者の案)。印刷用の見た目は TaskPage.css の @media print
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Printer, Plus } from 'lucide-react';
import { api } from '../../services/api';
import type { Task, TaskSection } from '../../types';
import './TaskPage.css';

const SECTIONS: { key: TaskSection; label: string }[] = [
  { key: 'decide', label: '決める' },
  { key: 'do', label: '手を動かす' },
  { key: 'waiting', label: '待ち' },
  { key: 'later', label: '今日でなくてよい' },
];
const STATUS_FILTERS: { key: string | undefined; label: string }[] = [
  { key: undefined, label: '残り' },
  { key: 'done', label: '済み' },
  { key: 'held', label: '保留' },
  { key: 'all', label: 'すべて' },
];
const NO_ROOM = '__none__';

interface Group { key: string; name: string; tasks: Task[] }

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

function TaskPage() {
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
      await api.addTask({ title, section: newSection, room_id: null });
      setNewTitle(''); setAdding(false);
      load(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remaining = tasks.filter((t) => t.status !== 'done').length;

  return (
    <div className="task-page">
      <header className="task-header no-print">
        <button className="task-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/talk'))} aria-label="戻る"><ArrowLeft size={22} /></button>
        <h1>タスク{status === undefined && <span className="task-count">{remaining}</span>}</h1>
        <button className={`task-reload ${reloading ? 'spinning' : ''}`} onClick={reload} disabled={reloading || loading} aria-label="読み直す" title="読み直す"><RefreshCw size={18} /></button>
        <button className="task-print" onClick={() => window.print()}><Printer size={18} /> 印刷</button>
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
                  <div key={t.id} className={`task-item ${t.status === 'done' ? 'done' : ''}`}>
                    <input
                      type="checkbox"
                      className="task-check"
                      aria-label={t.title}
                      checked={t.status === 'done'}
                      onChange={(e) => setDone(t, e.target.checked)}
                    />
                    <div className="task-body">
                      <div className="task-title">
                        <span className="task-no">{t.number}</span>
                        <span className="task-date">{madeOn(t.created_at)}</span>
                        {t.title}
                        {t.status === 'held' && <span className="task-held">保留</span>}
                      </div>
                      {(t.note || (t.room_id && t.source_message_ids.length > 0)) && (
                        <div className="task-note">
                          {t.note}
                          {t.room_id && t.source_message_ids.length > 0 && (
                            <button className="task-source no-print" onClick={() => navigate(`/rooms/${t.room_id}?msg=${t.source_message_ids[0]}`)}>元の会話 ›</button>
                          )}
                        </div>
                      )}
                      {t.ai_suggests_done && t.status !== 'done' && (
                        <button className="task-ai-done" onClick={() => setDone(t, true)}>AI: 済んだようです ✓</button>
                      )}
                    </div>
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

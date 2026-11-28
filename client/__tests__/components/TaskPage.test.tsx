/**
 * タスク一覧の画面 (docs/16、#661)。部屋の見出し → 区分 → 1 件 1 行。□で済み・AI の「済んだようです」は押せば済み。
 * ★ 印刷は「いま画面で絞っているもの」をそのまま (2026-11-26 利用者の案)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Task } from '../../src/types';

const base: Omit<Task, 'id' | 'number' | 'title' | 'section' | 'room_id' | 'room_name'> = {
  owner_id: 'u1', note: null, status: 'open', source_message_ids: [], ai_suggests_done: false,
  created_by: 'u1', done_at: null, done_by: null, sort_order: 0, due_date: null, created_at: '2026-11-26T00:00:00Z', updated_at: '2026-11-26T00:00:00Z',
};
const TASKS: Task[] = [
  { ...base, id: 't1', number: 1, title: 'ビルドしてよいか', section: 'decide', room_id: 'r1', room_name: '開発', note: 'よければ一言', source_message_ids: ['m1'] },
  { ...base, id: 't2', number: 5, title: 'タスクを登録', section: 'do', room_id: 'r1', room_name: '開発', ai_suggests_done: true },
  { ...base, id: 't3', number: 3, title: '返事を待つ', section: 'waiting', room_id: 'r2', room_name: '業務' },
  { ...base, id: 't4', number: 12, title: '個人のこと', section: 'do', room_id: null, room_name: null },
];

const api = vi.hoisted(() => ({
  listTasks: vi.fn(),
  updateTask: vi.fn(async () => ({ task: {} })),
  addTask: vi.fn(async () => ({ task: {} })),
  deleteTask: vi.fn(async () => ({ success: true })),
  getRooms: vi.fn(async () => ({ rooms: [
    { id: 'r1', type: 'group', name: '開発' }, { id: 'r2', type: 'group', name: '業務' }, { id: 'r3', type: 'group', name: '検査' },
    { id: 'r4', type: 'direct', name: null, partner_display_name: '田中' },
  ] })),
}));
vi.mock('../../src/services/api', () => ({ api }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

import TaskPage from '../../src/components/tasks/TaskPage';

const renderPage = () => render(<MemoryRouter><TaskPage /></MemoryRouter>);

describe('TaskPage', () => {
  beforeEach(() => {
    api.listTasks.mockReset().mockResolvedValue({ tasks: TASKS });
    api.updateTask.mockClear(); api.addTask.mockClear(); navigate.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('部屋の見出し → 区分 → 1 件。部屋なしは最後に「部屋なし」', async () => {
    renderPage();
    await screen.findByText('ビルドしてよいか');
    const groups = screen.getAllByRole('region').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['開発', '業務', '部屋なし']);
    const dev = within(screen.getByRole('region', { name: '開発' }));
    expect(dev.getByText('決める')).toBeTruthy();
    expect(dev.getByText('手を動かす')).toBeTruthy();
    expect(dev.getByText('よければ一言')).toBeTruthy();
  });

  it('★ 各行に番号 (会社全体の通し番号。並びの位置ではない)', async () => {
    renderPage();
    await screen.findByText('ビルドしてよいか');
    const nos = Array.from(document.querySelectorAll('.task-no')).map((e) => e.textContent);
    expect(nos).toEqual(['1', '5', '3', '12']);
  });

  it('★ 番号の横に作った日 (月/日)。番号に日付を入れない代わり (docs/16 §8-5)', async () => {
    api.listTasks.mockResolvedValue({ tasks: [{ ...TASKS[0], created_at: new Date(2026, 10, 3, 9, 0).toISOString() }] });
    renderPage();
    await screen.findByText('ビルドしてよいか');
    expect(document.querySelector('.task-date')?.textContent).toBe('11/3');
  });

  it('□ を押すと済みにする', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'ビルドしてよいか' }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('t1', { status: 'done' }));
  });

  it('AI の「済んだようです」は印として出て、押せば済み', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /済んだようです/ }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('t2', { status: 'done' }));
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /済んだようです/ })).toHaveLength(0));
  });

  it('元の会話へ: その投稿の位置で部屋を開く', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /元の会話/ }));
    expect(navigate).toHaveBeenCalledWith('/rooms/r1?msg=m1');
  });

  it('絞り: 「済み」で status=done を読み直す。部屋で絞ると見出しはその部屋だけ', async () => {
    renderPage();
    await screen.findByText('ビルドしてよいか');
    fireEvent.click(screen.getByRole('button', { name: '済み' }));
    await waitFor(() => expect(api.listTasks).toHaveBeenLastCalledWith({ status: 'done' }));
    fireEvent.click(screen.getByRole('button', { name: '残り' }));
    await screen.findByText('ビルドしてよいか');
    fireEvent.change(screen.getByLabelText('部屋'), { target: { value: 'r2' } });
    expect(screen.getAllByRole('region').map((g) => g.getAttribute('aria-label'))).toEqual(['業務']);
  });

  it('★ 印刷は、いま画面で絞っているものをそのまま (window.print)', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderPage();
    await screen.findByText('ビルドしてよいか');
    fireEvent.click(screen.getByRole('button', { name: /印刷/ }));
    expect(print).toHaveBeenCalled();
  });

  it('手で足せる (題と区分)', async () => {
    renderPage();
    await screen.findByText('ビルドしてよいか');
    fireEvent.click(screen.getByRole('button', { name: /足す/ }));
    fireEvent.change(screen.getByPlaceholderText('やること'), { target: { value: '見積りを出す' } });
    fireEvent.change(screen.getByLabelText('区分'), { target: { value: 'decide' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    await waitFor(() => expect(api.addTask).toHaveBeenCalledWith({ title: '見積りを出す', section: 'decide', room_id: null }));
  });

  it('★ タスク 32 読み直すボタン: 今の絞り (状態) のまま引き直し、引いている間も一覧は消さない', async () => {
    renderPage();
    await screen.findByText('ビルドしてよいか');
    fireEvent.click(screen.getByRole('button', { name: '済み' }));
    await waitFor(() => expect(api.listTasks).toHaveBeenLastCalledWith({ status: 'done' }));
    let release: (v: { tasks: Task[] }) => void = () => {};
    api.listTasks.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const n = api.listTasks.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '読み直す' }));
    expect(api.listTasks).toHaveBeenCalledTimes(n + 1);
    expect(api.listTasks).toHaveBeenLastCalledWith({ status: 'done' });
    expect(screen.queryByText('読み込み中...')).toBeNull();
    expect(screen.getByText('ビルドしてよいか')).toBeTruthy();
    expect((screen.getByRole('button', { name: '読み直す' }) as HTMLButtonElement).disabled).toBe(true);
    release({ tasks: [{ ...TASKS[0], title: 'AI が足した' }] });
    await screen.findByText('AI が足した');
    expect((screen.getByRole('button', { name: '読み直す' }) as HTMLButtonElement).disabled).toBe(false);
  });

  describe('★ タスク 33 期限 (docs/16 §5・§8-6)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 10, 30, 10, 0));   // 今日 = 2026-11-30 (端末の暦)
      api.listTasks.mockResolvedValue({ tasks: [
        { ...TASKS[0], due_date: '2026-11-29' },
        { ...TASKS[1], due_date: '2026-11-30' },
        { ...TASKS[2], due_date: '2026-12-05' },
        { ...TASKS[3], due_date: '2026-11-01', status: 'done' },
      ] });
    });
    afterEach(() => vi.useRealTimers());

    const row = (title: string) => screen.getByText(title).closest('.task-item') as HTMLElement;

    it('題の後ろに「〆月/日」。期限切れ・今日までは字で出す (印刷で色が落ちても読める)。済みには出さない', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      expect(within(row('ビルドしてよいか')).getByText('〆11/29')).toBeTruthy();
      expect(within(row('ビルドしてよいか')).getByText('期限切れ').className).toContain('overdue');
      expect(within(row('タスクを登録')).getByText('今日まで').className).toContain('today');
      expect(within(row('返事を待つ')).getByText('〆12/5')).toBeTruthy();
      expect(within(row('返事を待つ')).queryByText(/期限切れ|今日まで/)).toBeNull();
      expect(within(row('個人のこと')).getByText('〆11/1')).toBeTruthy();
      expect(within(row('個人のこと')).queryByText('期限切れ')).toBeNull();
    });

    it('見出しの数字の横に、期限切れの件数を赤で', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      expect(screen.getByLabelText('期限切れ 1 件').textContent).toBe('1');
    });

    it('期限切れが無ければ赤い数字は出さない', async () => {
      api.listTasks.mockResolvedValue({ tasks: [{ ...TASKS[0], due_date: '2026-12-01' }] });
      renderPage();
      await screen.findByText('ビルドしてよいか');
      expect(screen.queryByLabelText(/期限切れ \d+ 件/)).toBeNull();
    });

    it('★ 並びは本体が返した順のまま (期限で並べ替えない)', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      const nos = Array.from(document.querySelectorAll('.task-no')).map((e) => e.textContent);
      expect(nos).toEqual(['1', '5', '3', '12']);
    });

    it('★ 各行の「直す」で題・ひとこと・区分・期限を変える。「直す」は印刷に出さない', async () => {
      api.updateTask.mockImplementationOnce((async (id: string, f: Partial<Task>) => ({ task: { ...TASKS[0], ...f, id } })) as never);
      renderPage();
      await screen.findByText('ビルドしてよいか');
      const edit = within(row('ビルドしてよいか')).getByRole('button', { name: '直す' });
      expect(edit.className).toContain('no-print');
      fireEvent.click(edit);
      const form = within(screen.getByRole('form', { name: '直す' }));
      expect((form.getByLabelText('期限') as HTMLInputElement).value).toBe('2026-11-29');
      fireEvent.change(form.getByLabelText('題'), { target: { value: 'ビルドの可否' } });
      fireEvent.change(form.getByLabelText('ひとこと'), { target: { value: '' } });
      fireEvent.change(form.getByLabelText('区分'), { target: { value: 'waiting' } });
      fireEvent.change(form.getByLabelText('期限'), { target: { value: '2026-12-10' } });
      fireEvent.click(form.getByRole('button', { name: '保存' }));
      await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('t1', { title: 'ビルドの可否', note: null, section: 'waiting', due_date: '2026-12-10' }));
      expect(await screen.findByText('〆12/10')).toBeTruthy();
      expect(screen.queryByRole('form', { name: '直す' })).toBeNull();
    });

    it('期限は空にできる (「期限なし」→ null で送る)', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      fireEvent.click(within(row('ビルドしてよいか')).getByRole('button', { name: '直す' }));
      const form = within(screen.getByRole('form', { name: '直す' }));
      fireEvent.click(form.getByRole('button', { name: '期限なし' }));
      expect((form.getByLabelText('期限') as HTMLInputElement).value).toBe('');
      fireEvent.click(form.getByRole('button', { name: '保存' }));
      await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('t1', expect.objectContaining({ due_date: null })));
    });

    it('題を空にしては保存しない。「やめる」で何も送らずに戻る', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      fireEvent.click(within(row('ビルドしてよいか')).getByRole('button', { name: '直す' }));
      const form = within(screen.getByRole('form', { name: '直す' }));
      fireEvent.change(form.getByLabelText('題'), { target: { value: '  ' } });
      expect((form.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(form.getByRole('button', { name: 'やめる' }));
      expect(screen.queryByRole('form', { name: '直す' })).toBeNull();
      expect(api.updateTask).not.toHaveBeenCalled();
      expect(screen.getByText('ビルドしてよいか')).toBeTruthy();
    });
  });

  it('0 件なら「残っているタスクはありません」', async () => {
    api.listTasks.mockResolvedValue({ tasks: [] });
    renderPage();
    expect(await screen.findByText('残っているタスクはありません')).toBeTruthy();
  });
  /** docs/16 §8-7 (11-28): 保留は区分の 5 つ目。部屋の最後・題名だけ薄く・「保留 11/28〜」・残りの数に入れない */
  describe('保留 (区分 held)', () => {
    const HELD: Task = { ...base, id: 'th', number: 11, title: '班の作り方', section: 'held', room_id: 'r1', room_name: '開発', held_at: '2026-11-28T00:10:00Z' } as Task;

    it('★★ 部屋の中のいちばん最後に「保留」の見出しで並び、題の後ろに「保留 11/28〜」', async () => {
      api.listTasks.mockResolvedValue({ tasks: [...TASKS.slice(0, 2), HELD, ...TASKS.slice(2)] });
      renderPage();
      await screen.findByText('班の作り方');
      const dev = screen.getByRole('region', { name: '開発' });
      const labels = Array.from(dev.querySelectorAll('.task-section-label')).map((e) => e.textContent);
      expect(labels).toEqual(['決める', '手を動かす', '保留']);
      expect(within(dev).getByText('保留 11/28〜')).toBeTruthy();
    });

    it('★★ 見出しの残りの数に入れない (時間稼ぎが効くように)。隠しはしない', async () => {
      api.listTasks.mockResolvedValue({ tasks: [...TASKS, HELD] });
      renderPage();
      await screen.findByText('班の作り方');
      expect(document.querySelector('.task-count')?.textContent).toBe('4');
    });

    it('★ 題名だけ薄くする印 (held)。済みの取り消し線とは別', async () => {
      api.listTasks.mockResolvedValue({ tasks: [HELD] });
      renderPage();
      await screen.findByText('班の作り方');
      const item = document.querySelector('.task-item');
      expect(item?.classList.contains('held')).toBe(true);
      expect(item?.classList.contains('done')).toBe(false);
    });

    it('★ 「直す」の区分に「保留」がある。選んで保存すると section: held を送る', async () => {
      renderPage();
      await screen.findByText('個人のこと');
      fireEvent.click(screen.getAllByRole('button', { name: '直す' })[3]);
      const form = screen.getByRole('form', { name: '直す' });
      const select = within(form).getByLabelText('区分');
      expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toContain('保留');
      fireEvent.change(select, { target: { value: 'held' } });
      fireEvent.click(within(form).getByRole('button', { name: '保存' }));
      await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('t4', expect.objectContaining({ section: 'held' })));
    });
  });

  /** 11-28 利用者の案: 何回も見ていると説明は知っているので、題名の一覧を多く見たい。説明をたためる */
  describe('説明をたたむ', () => {
    beforeEach(() => { try { localStorage.removeItem('taskNotesFolded'); } catch { /* */ } });

    it('★ 最初は今どおり説明が出ている', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      expect(screen.getByText('よければ一言')).toBeTruthy();
      expect(screen.getByRole('button', { name: '説明をたたむ' })).toBeTruthy();
    });

    it('★★ 「説明をたたむ」で全部の説明が消え、題名・期限の印・「AI: 済んだようです」は残る。押し直すと全部出る', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      fireEvent.click(screen.getByRole('button', { name: '説明をたたむ' }));
      expect(screen.queryByText('よければ一言')).toBeNull();
      expect(screen.queryByRole('button', { name: /元の会話/ })).toBeNull();
      expect(screen.getByText('ビルドしてよいか')).toBeTruthy();
      expect(screen.getByRole('button', { name: /済んだようです/ })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '説明を出す' }));
      expect(screen.getByText('よければ一言')).toBeTruthy();
    });

    it('★ たたんでいるとき、説明のあるタスクには印。題名を押すとその 1 件だけ開き、もう一度で閉じる', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      fireEvent.click(screen.getByRole('button', { name: '説明をたたむ' }));
      const toggles = screen.getAllByRole('button', { name: /説明を開く/ });
      expect(toggles).toHaveLength(1); // 説明 (または元の会話) があるのは t1 だけ
      fireEvent.click(toggles[0]);
      expect(screen.getByText('よければ一言')).toBeTruthy();
      expect(screen.getByRole('button', { name: /元の会話/ })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /説明を閉じる/ }));
      expect(screen.queryByText('よければ一言')).toBeNull();
    });

    it('★ 選んだ方はその端末で覚えておく (開き直してもたたんだまま)', async () => {
      const first = renderPage();
      await screen.findByText('ビルドしてよいか');
      fireEvent.click(screen.getByRole('button', { name: '説明をたたむ' }));
      first.unmount();
      renderPage();
      await screen.findByText('ビルドしてよいか');
      expect(screen.queryByText('よければ一言')).toBeNull();
      expect(screen.getByRole('button', { name: '説明を出す' })).toBeTruthy();
    });

    it('覚えておく場所が使えなくても画面は出る (開いた状態)', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      renderPage();
      await screen.findByText('ビルドしてよいか');
      expect(screen.getByText('よければ一言')).toBeTruthy();
    });
  });

  /** docs/16 §5.1 マルチトークの右の帯に置くとき */
  describe('★ 部屋 (11-28 採用者の知らせ: 部屋を選んで足しても「部屋なし」に入った)', () => {
    const row = (title: string) => screen.getByText(title).closest('.task-item') as HTMLElement;
    const addOne = async (title: string) => {
      fireEvent.click(screen.getByRole('button', { name: /足す/ }));
      fireEvent.change(screen.getByPlaceholderText('やること'), { target: { value: title } });
      fireEvent.click(screen.getByRole('button', { name: '追加' }));
    };

    it('★★ 部屋を絞っているときに足したら、その部屋に入れる (足す先も見せる)', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      fireEvent.change(screen.getByLabelText('部屋'), { target: { value: 'r2' } });
      fireEvent.click(screen.getByRole('button', { name: /足す/ }));
      expect(screen.getByText('# 業務 に足します')).toBeTruthy();
      fireEvent.change(screen.getByPlaceholderText('やること'), { target: { value: '検査の段取り' } });
      fireEvent.click(screen.getByRole('button', { name: '追加' }));
      await waitFor(() => expect(api.addTask).toHaveBeenCalledWith({ title: '検査の段取り', section: 'do', room_id: 'r2' }));
    });

    it('「部屋なし」に絞っているとき・全部のときは部屋なしで足す', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      fireEvent.change(screen.getByLabelText('部屋'), { target: { value: '__none__' } });
      await addOne('A');
      await waitFor(() => expect(api.addTask).toHaveBeenLastCalledWith({ title: 'A', section: 'do', room_id: null }));
    });

    it('★★ 「直す」で部屋を変えられる。選べるのは自分が入っている部屋 (1 対 1 は相手の名前) と部屋なし', async () => {
      api.updateTask.mockImplementationOnce((async (id: string, f: Partial<Task>) => ({ task: { ...TASKS[2], ...f, id, room_name: '検査' } })) as never);
      renderPage();
      await screen.findByText('返事を待つ');
      fireEvent.click(within(row('返事を待つ')).getByRole('button', { name: '直す' }));
      const form = within(screen.getByRole('form', { name: '直す' }));
      const sel = await form.findByLabelText('部屋') as HTMLSelectElement;
      await waitFor(() => expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['部屋なし', '開発', '業務', '検査', '田中']));
      expect(sel.value).toBe('r2');
      fireEvent.change(sel, { target: { value: 'r3' } });
      fireEvent.click(form.getByRole('button', { name: '保存' }));
      await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('t3', { title: '返事を待つ', note: null, section: 'waiting', due_date: null, room_id: 'r3' }));
      expect(await screen.findByRole('region', { name: '検査' })).toBeTruthy();
    });

    it('部屋を変えなければ room_id は送らない', async () => {
      renderPage();
      await screen.findByText('返事を待つ');
      fireEvent.click(within(row('返事を待つ')).getByRole('button', { name: '直す' }));
      const form = within(screen.getByRole('form', { name: '直す' }));
      fireEvent.click(form.getByRole('button', { name: '保存' }));
      await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('t3', { title: '返事を待つ', note: null, section: 'waiting', due_date: null }));
    });

    it('★ 元の会話つきのタスクの部屋を変えたら、元の会話へのつなぎは外す (別の部屋へ飛んでしまうため)。その旨を出す', async () => {
      renderPage();
      await screen.findByText('ビルドしてよいか');
      fireEvent.click(within(row('ビルドしてよいか')).getByRole('button', { name: '直す' }));
      const form = within(screen.getByRole('form', { name: '直す' }));
      const sel = await form.findByLabelText('部屋') as HTMLSelectElement;
      await waitFor(() => expect(sel.options.length).toBeGreaterThan(1));
      expect(form.queryByText(/元の会話へのつなぎは外れます/)).toBeNull();
      fireEvent.change(sel, { target: { value: '' } });
      expect(form.getByText(/元の会話へのつなぎは外れます/)).toBeTruthy();
      fireEvent.click(form.getByRole('button', { name: '保存' }));
      await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('t1', expect.objectContaining({ room_id: null, source_message_ids: [] })));
    });

    it('一覧に無い部屋 (抜けた部屋など) にあるタスクでも、今の部屋を選択肢に残す', async () => {
      api.listTasks.mockResolvedValue({ tasks: [{ ...TASKS[2], room_id: 'r9', room_name: '昔の部屋' }] });
      renderPage();
      await screen.findByText('返事を待つ');
      fireEvent.click(within(row('返事を待つ')).getByRole('button', { name: '直す' }));
      const sel = await within(screen.getByRole('form', { name: '直す' })).findByLabelText('部屋') as HTMLSelectElement;
      await waitFor(() => expect(Array.from(sel.options).map((o) => o.textContent)).toContain('昔の部屋'));
      expect(sel.value).toBe('r9');
    });
  });

  describe('帯の中 (embedded)', () => {
    const onOpenSource = vi.fn();
    const renderEmbedded = () => render(<MemoryRouter><TaskPage embedded onOpenSource={onOpenSource} /></MemoryRouter>);
    beforeEach(() => onOpenSource.mockClear());

    it('★ 「戻る」と「印刷」は出さない。読み直すは出す', async () => {
      renderEmbedded();
      await screen.findByText('ビルドしてよいか');
      expect(screen.queryByRole('button', { name: '戻る' })).toBeNull();
      expect(screen.queryByRole('button', { name: /印刷/ })).toBeNull();
      expect(screen.getByRole('button', { name: '読み直す' })).toBeTruthy();
    });

    it('★★ 「元の会話」は画面を移らず、部屋と発言を渡す (マルチトークがパネルで開く)', async () => {
      renderEmbedded();
      fireEvent.click(await screen.findByRole('button', { name: /元の会話/ }));
      expect(onOpenSource).toHaveBeenCalledWith({ id: 'r1', name: '開発', msgId: 'm1' });
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});

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
  created_by: 'u1', done_at: null, done_by: null, sort_order: 0, created_at: '2026-11-26T00:00:00Z', updated_at: '2026-11-26T00:00:00Z',
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

  it('0 件なら「残っているタスクはありません」', async () => {
    api.listTasks.mockResolvedValue({ tasks: [] });
    renderPage();
    expect(await screen.findByText('残っているタスクはありません')).toBeTruthy();
  });
});

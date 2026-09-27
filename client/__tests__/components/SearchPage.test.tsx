/**
 * 検索画面: タグを選んでいるのに、タグの条件なしで検索してしまう (2026-09-27)
 *
 * ★ 利用者の報告: 「クレーム」タグを選んでルーム内でワードを入れると、タグと関係ないものが出る。
 * ★ 本体のログ: 16:44:07 はタグ付きで 21 件 → 結果を開いて戻った 16:45:22 以降、同じワードが
 *   **タグ無し** (tags=) で 50 件。本体の SQL はタグを INNER JOIN で絞っていて正しい。
 * ★ 原因: 戻ったとき、保存しておいた「選んでいたタグ」で自動的に検索し直す。その時点では
 *   タグの一覧 (allTags) がまだ届いておらず、タグ名から id を引けない → 条件を付けずに投げていた。
 * → id が引けなければタグ名で絞る (本体は room_id + tag_names にも対応している)。
 */
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const search = vi.fn((_q: string, _opts: Record<string, unknown>) => Promise.resolve({ results: [] }));
let resolveRoomTags: (v: unknown) => void = () => {};

vi.mock('../../src/services/api', () => ({
  api: {
    search: (q: string, opts: Record<string, unknown>) => search(q, opts),
    getTodoTags: vi.fn(() => Promise.resolve({ tags: [] })),
    // ★ タグの一覧はすぐには届かない (戻った直後の状態を作る)
    getRoomTags: vi.fn(() => new Promise((r) => { resolveRoomTags = r; })),
    getAllTags: vi.fn(() => Promise.resolve({ tags: [] })),
    updateMessageTag: vi.fn(),
  },
}));

import SearchPage from '../../src/components/search/SearchPage';

const hasTagCondition = (opts: Record<string, unknown>) =>
  !!opts.tagId || (Array.isArray(opts.tagNames) && (opts.tagNames as string[]).length > 0);

describe('SearchPage — タグを選んでいる間は、必ずタグで絞って検索する', () => {
  beforeEach(() => {
    search.mockClear();
    sessionStorage.clear();
  });

  it('★★ 結果から戻った直後 (タグの一覧がまだ無い) の自動検索も、タグで絞る', async () => {
    sessionStorage.setItem('searchCache', JSON.stringify({ query: 'トラクター', selectedTags: ['クレーム'], results: [] }));
    render(<MemoryRouter initialEntries={['/search?room_id=R1']}><SearchPage /></MemoryRouter>);

    await waitFor(() => expect(search).toHaveBeenCalled());
    for (const [, opts] of search.mock.calls) expect(hasTagCondition(opts)).toBe(true);
    expect(search.mock.calls[0][1]).toMatchObject({ roomId: 'R1', tagNames: ['クレーム'] });
  });

  it('★ タグの一覧が届く前にワードを入れても、タグで絞る', async () => {
    sessionStorage.setItem('searchCache', JSON.stringify({ query: '', selectedTags: ['クレーム'], results: [] }));
    render(<MemoryRouter initialEntries={['/search?room_id=R1']}><SearchPage /></MemoryRouter>);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'トラクター' } });

    await waitFor(() => expect(search.mock.calls.some(([q]) => q === 'トラクター')).toBe(true), { timeout: 2000 });
    for (const [, opts] of search.mock.calls) expect(hasTagCondition(opts)).toBe(true);
  });

  it('★★ 古い検索の応答があとから届いても、新しい結果を上書きしない', async () => {
    // 1 本目 (クレーム) は遅く、2 本目 (クレーム+配送) は速く返る
    let resolveSlow: (v: unknown) => void = () => {};
    search.mockImplementationOnce(() => new Promise((r) => { resolveSlow = r as (v: unknown) => void; }) as never);
    search.mockImplementationOnce(() => Promise.resolve({ results: [{ id: 'new', room_id: 'R1', content: '新しい結果', type: 'text', created_at: '2026-09-27T00:00:00Z' }] }) as never);
    sessionStorage.setItem('searchCache', JSON.stringify({ query: '', selectedTags: [], results: [] }));
    render(<MemoryRouter initialEntries={['/search?room_id=R1']}><SearchPage /></MemoryRouter>);
    resolveRoomTags({ tags: [
      { id: 'tag-claim', name: 'クレーム', is_todo: false, total_usage: 98 },
      { id: 'tag-del', name: '配送', is_todo: false, total_usage: 563 },
    ] });
    fireEvent.click(await screen.findByText(/クレーム/));
    fireEvent.click(await screen.findByText(/配送/));
    expect(await screen.findByText(/新しい結果/)).toBeTruthy();

    // ★ 古い方 (1 本目) が今ごろ返ってくる
    resolveSlow({ results: [{ id: 'old', room_id: 'R1', content: '古い結果', type: 'text', created_at: '2026-09-26T00:00:00Z' }] });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/古い結果/)).toBeNull();
    expect(screen.getByText(/新しい結果/)).toBeTruthy();
  });

  it('タグの一覧が届いた後は、今までどおり tag_id で絞る (速い方)', async () => {
    sessionStorage.setItem('searchCache', JSON.stringify({ query: '', selectedTags: [], results: [] }));
    render(<MemoryRouter initialEntries={['/search?room_id=R1']}><SearchPage /></MemoryRouter>);
    resolveRoomTags({ tags: [{ id: 'tag-claim', name: 'クレーム', is_todo: false, total_usage: 98 }] });
    const chip = await screen.findByText(/クレーム/);
    fireEvent.click(chip);

    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(search.mock.calls.at(-1)![1]).toMatchObject({ roomId: 'R1', tagId: 'tag-claim' });
  });
});

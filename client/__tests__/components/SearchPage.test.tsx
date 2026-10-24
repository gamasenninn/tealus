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
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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

// #472 結果を開くとき「どの検索から来たか」を state に残す (部屋の検索アイコンが前の検索画面へ戻れるように)
function LocationProbe() {
  const loc = useLocation();
  return <p data-testid="probe">{loc.pathname}|{JSON.stringify(loc.state)}</p>;
}

describe('SearchPage — 結果を開くとき、どの検索から来たかを残す (#472)', () => {
  const result = { id: 'm1', room_id: 'R1', content: 'ご相談の件', type: 'text', created_at: '2026-09-29T00:00:00Z' };
  beforeEach(() => { search.mockClear(); sessionStorage.clear(); });

  const openFirstResult = async (entry: string) => {
    sessionStorage.setItem('searchCache', JSON.stringify({ query: '見積', selectedTags: [], results: [result] }));
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/search" element={<SearchPage />} />
          <Route path="/rooms/:roomId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText(/ご相談の件/));
    return screen.findByTestId('probe');
  };

  it('★ 部屋内検索: その部屋の id を残す', async () => {
    const probe = await openFirstResult('/search?room_id=R1');
    expect(probe.textContent).toBe('/rooms/R1|{"fromSearch":{"roomId":"R1"}}');
  });

  it('全体検索: 部屋の id は null (部屋の検索アイコンは部屋内検索を開く)', async () => {
    const probe = await openFirstResult('/search');
    expect(probe.textContent).toBe('/rooms/R1|{"fromSearch":{"roomId":null}}');
  });
});

// ★ 2026-10-23 小野さん判断 (改善ループ 12 回目の B6): 読み込みの失敗を「一致するものはありません」と同じ画面にしない
describe('SearchPage — 読み込みの失敗', () => {
  beforeEach(() => { search.mockClear(); sessionStorage.clear(); });

  it('★ 検索が失敗したら「読み込めませんでした: 理由」を出し、「ありません」は出さない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    search.mockRejectedValueOnce(new Error('つながっていません。電波を確かめて、もう一度お試しください'));
    render(<MemoryRouter initialEntries={['/search']}><SearchPage /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('全ルーム検索...'), { target: { value: 'トラクター' } });
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('読み込めませんでした: つながっていません');
    expect(screen.queryByText(/一致するメッセージはありません/)).toBeNull();
  });
});

describe('SearchPage — 失敗したら前の結果を残さない (改善ループ 14 回目)', () => {
  beforeEach(() => { search.mockReset(); sessionStorage.clear(); });

  it('★ 前の語の結果が、失敗の表示の下に並ばない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    search.mockResolvedValueOnce({ results: [{ id: 'm1', room_id: 'r1', content: '前の語の結果です', type: 'text', created_at: '2026-10-24T00:00:00Z', sender_display_name: 'A', room_name: '部屋' }] } as never);
    search.mockRejectedValueOnce(new Error('つながっていません'));
    render(<MemoryRouter initialEntries={['/search']}><SearchPage /></MemoryRouter>);
    const input = screen.getByPlaceholderText('全ルーム検索...');
    fireEvent.change(input, { target: { value: 'トラクター' } });
    expect(await screen.findByText(/前の語の結果です/, {}, { timeout: 3000 })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'コンバイン' } });
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('読み込めませんでした');
    expect(screen.queryByText(/前の語の結果です/)).toBeNull();
  });
});

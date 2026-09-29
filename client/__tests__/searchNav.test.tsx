/**
 * #472 部屋の中の検索で結果を見比べると、← で元の部屋に戻るまでが長くなる
 *
 * 約束: 検索は寄り道。何件見比べても、← 2 回で元の部屋に戻る (部屋 → 検索 → 結果 の 3 段を超えない)。
 * 検索結果から来た部屋では、部屋の検索アイコンは新しく積まずに前の検索画面へ戻る。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { roomSearchAction, searchResultState } from '../src/utils/searchNav';

describe('roomSearchAction', () => {
  it('★ 部屋内検索の結果から来た同じ部屋では、前の検索画面へ戻る', () => {
    expect(roomSearchAction(searchResultState('R1'), 'R1')).toEqual({ type: 'back' });
  });

  it('★ リンクで直接開いた部屋 (state が無い) では、検索画面を新しく開く (外へ出ない)', () => {
    expect(roomSearchAction(null, 'R1')).toEqual({ type: 'open', to: '/search?room_id=R1' });
    expect(roomSearchAction(undefined, 'R1')).toEqual({ type: 'open', to: '/search?room_id=R1' });
  });

  it('★ 全体検索から来た部屋では、部屋内の検索を新しく開く (全体検索には戻らない)', () => {
    expect(roomSearchAction(searchResultState(null), 'R1')).toEqual({ type: 'open', to: '/search?room_id=R1' });
  });

  it('別の部屋の検索から来た印は使わない', () => {
    expect(roomSearchAction(searchResultState('R2'), 'R1')).toEqual({ type: 'open', to: '/search?room_id=R1' });
  });

  it('形の違う state は無視する', () => {
    expect(roomSearchAction({ fromSearch: 'R1' }, 'R1')).toEqual({ type: 'open', to: '/search?room_id=R1' });
    expect(roomSearchAction({ other: 1 }, 'R1')).toEqual({ type: 'open', to: '/search?room_id=R1' });
  });
});

// ── 実際の画面遷移で確かめる (部屋と検索画面の、遷移に関わる部分だけの見本) ──
function FakeRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div>
      <p>room:{roomId}{location.search.includes('msg=') ? ':msg' : ''}</p>
      <button onClick={() => navigate(-1)}>room-back</button>
      <button onClick={() => {
        const a = roomSearchAction(location.state, roomId!);
        if (a.type === 'back') navigate(-1); else navigate(a.to);
      }}>room-search</button>
    </div>
  );
}

function FakeSearch() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const roomId = sp.get('room_id');
  return (
    <div>
      <p>search:{roomId ?? 'all'}</p>
      <button onClick={() => navigate(-1)}>search-back</button>
      {['m1', 'm2', 'm3'].map(id => (
        <button key={id} onClick={() => navigate(`/rooms/R1?msg=${id}`, { state: searchResultState(roomId) })}>{id}</button>
      ))}
    </div>
  );
}

function renderApp(initial: string[]) {
  return render(
    <MemoryRouter initialEntries={initial} initialIndex={initial.length - 1}>
      <Routes>
        <Route path="/talk" element={<p>talk</p>} />
        <Route path="/rooms/:roomId" element={<FakeRoom />} />
        <Route path="/search" element={<FakeSearch />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('#472 画面遷移', () => {
  it('★★ 部屋内検索で 3 件見比べた後 (毎回検索アイコンで戻る)、← 2 回で元の部屋に戻る', () => {
    renderApp(['/talk', '/rooms/R1']);
    fireEvent.click(screen.getByText('room-search'));
    for (const id of ['m1', 'm2', 'm3']) {
      fireEvent.click(screen.getByText(id));
      expect(screen.getByText('room:R1:msg')).toBeTruthy();
      fireEvent.click(screen.getByText('room-search'));
      expect(screen.getByText('search:R1')).toBeTruthy();
    }
    fireEvent.click(screen.getByText('search-back'));
    expect(screen.getByText('room:R1')).toBeTruthy();   // 元の部屋 (msg 無し)
    fireEvent.click(screen.getByText('room-back'));
    expect(screen.getByText('talk')).toBeTruthy();
  });

  it('結果の部屋から ← で戻っても今までどおり検索画面に戻る', () => {
    renderApp(['/talk', '/rooms/R1']);
    fireEvent.click(screen.getByText('room-search'));
    fireEvent.click(screen.getByText('m1'));
    fireEvent.click(screen.getByText('room-back'));
    expect(screen.getByText('search:R1')).toBeTruthy();
  });

  it('★ リンクで直接開いた結果の部屋では、検索アイコンで検索画面が開く (外へ出ない)', () => {
    renderApp(['/rooms/R1?msg=m9']);
    fireEvent.click(screen.getByText('room-search'));
    expect(screen.getByText('search:R1')).toBeTruthy();
  });

  it('★ 全体検索から入った部屋では、検索アイコンで部屋内検索が開く', () => {
    renderApp(['/talk', '/search']);
    fireEvent.click(screen.getByText('m1'));
    fireEvent.click(screen.getByText('room-search'));
    expect(screen.getByText('search:R1')).toBeTruthy();
  });
});

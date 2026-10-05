/**
 * #487 `/talk` で部屋の一覧 (RoomList) が 2 つ動いていた
 *
 * ★ サイドバーの RoomList は CSS で隠しているだけで、スマホでも常に動いている (DesktopShell)。
 *   そこへ `/talk` の本体にも RoomList を置いていたので、PC では一覧が 2 つ並び、
 *   スマホでも裏で 2 つ動いて新着の音・一覧の取り直しが 2 回ずつ起きていた。
 * ★ 一覧の部品は常にサイドバーの 1 つだけ。`/talk` では見え方だけを変える
 *   (スマホ: サイドバーを全画面で出す / PC: 本体に「左から選ぶ」案内)。
 *   サイドバーを外さないのは、スマホでトークを開いている間もほかの部屋の新着の音を鳴らしているため。
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/components/room-list/RoomList', () => ({
  default: () => <div data-testid="room-list" />,
}));

import DesktopShell from '../../src/components/layout/DesktopShell';
import TalkPage from '../../src/components/room-list/TalkPage';
import { useMultiTalkStore } from '../../src/stores/multiTalkStore';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<DesktopShell />}>
          <Route path="/talk" element={<TalkPage />} />
          <Route path="/rooms/:roomId" element={<div>chat</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('DesktopShell / TalkPage (#487)', () => {
  it('/talk でも RoomList は 1 つだけ', () => {
    renderAt('/talk');
    expect(screen.getAllByTestId('room-list')).toHaveLength(1);
  });

  it('/talk では shell に目印の class が付く (スマホでサイドバーを全画面で出すため)', () => {
    const { container } = renderAt('/talk');
    expect(container.querySelector('.desktop-shell')?.classList.contains('desktop-shell--talk')).toBe(true);
  });

  it('/talk の本体は案内だけ (PC で「左の一覧から選ぶ」)', () => {
    renderAt('/talk');
    expect(screen.getByText('左の一覧からトークを選んでください')).toBeTruthy();
  });

  it('トークを開いているときは目印が付かず、RoomList は 1 つ', () => {
    const { container } = renderAt('/rooms/r-1');
    expect(container.querySelector('.desktop-shell')?.classList.contains('desktop-shell--talk')).toBe(false);
    expect(screen.getAllByTestId('room-list')).toHaveLength(1);
  });
});

/**
 * #502 PC のマルチトーク
 * ★ `/multi` には MultiTalk の中にも一覧があり、「トーク」が 2 つ並んでいた (押した結果も違った)。
 *   一覧は RoomList 1 つにそろえ、`/multi` ではそれでパネルを開く
 * ★★ パネルの中身は iframe (`/rooms/:id?embed=true`) で、そこも DesktopShell に包まれていたので、
 *   見えない RoomList がパネルの数だけ動いて通知音が重なった (パネル 3 枚で 4 回)
 */
describe('DesktopShell — マルチトーク (#502)', () => {
  function renderMulti(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<DesktopShell />}>
            <Route path="/multi" element={<div>multi</div>} />
            <Route path="/rooms/:roomId" element={<div>chat</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  }

  beforeEach(() => { useMultiTalkStore.setState({ sidebarHidden: false }); });

  it('★★ iframe の中 (embed=true) では RoomList を動かさない', () => {
    renderMulti('/rooms/r-1?embed=true');
    expect(screen.queryByTestId('room-list')).toBeNull();
    expect(screen.getByText('chat')).toBeTruthy();
  });

  it('★ /multi では目印の class が付き、RoomList は 1 つ', () => {
    const { container } = renderMulti('/multi');
    expect(container.querySelector('.desktop-shell')?.classList.contains('desktop-shell--multi')).toBe(true);
    expect(screen.getAllByTestId('room-list')).toHaveLength(1);
  });

  it('★ /multi で一覧を隠すと、隠す目印が付く (RoomList は動かしたまま = 音は止めない)', () => {
    useMultiTalkStore.setState({ sidebarHidden: true });
    const { container } = renderMulti('/multi');
    expect(container.querySelector('.desktop-shell')?.classList.contains('desktop-shell--sidebar-hidden')).toBe(true);
    expect(screen.getAllByTestId('room-list')).toHaveLength(1);
  });

  it('★ 隠したのは /multi の中だけ。ほかの画面では一覧が出る', () => {
    useMultiTalkStore.setState({ sidebarHidden: true });
    const { container } = renderMulti('/rooms/r-1');
    expect(container.querySelector('.desktop-shell')?.classList.contains('desktop-shell--sidebar-hidden')).toBe(false);
  });
});

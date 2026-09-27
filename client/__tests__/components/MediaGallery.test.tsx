/**
 * メディア一覧: 遅れて返った古い応答が、新しい結果を上書きする (2026-09-27、#461 と同じ形)
 *
 * ★ 検索画面 (#461) で、応答を返ってきた順に画面へ入れていたため古い結果が新しい結果を上書きした。
 *   メディア一覧のタグ・種類の切り替えも同じ作りだった。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

const getMediaGallery = vi.fn();
vi.mock('../../src/services/api', () => ({
  api: {
    getMediaGallery: (...a: unknown[]) => getMediaGallery(...a),
    getRoomTags: vi.fn(() => Promise.resolve({ tags: [{ id: 't1', name: 'クレーム' }] })),
    getRoom: vi.fn(() => Promise.resolve({ room: { name: '通話履歴' } })),
  },
}));

import MediaGallery from '../../src/components/media/MediaGallery';

const item = (id: string, name: string) => ({
  id, file_name: name, file_path: `${id}.jpg`, thumbnail_path: null, mime_type: 'image/jpeg',
  message_id: `m-${id}`, message_created_at: '2026-09-27T00:00:00Z',
});

describe('MediaGallery — 古い応答で新しい結果を上書きしない', () => {
  it('★★ タグを選んだ後に、選ぶ前の遅い応答が届いても、選んだタグの結果のまま', async () => {
    let resolveSlow: (v: unknown) => void = () => {};
    getMediaGallery.mockImplementationOnce(() => new Promise((r) => { resolveSlow = r; }));   // 最初 (タグなし) は遅い
    getMediaGallery.mockImplementationOnce(() => Promise.resolve({ media: [item('new', 'タグの写真.jpg')], has_more: false }));

    render(
      <MemoryRouter initialEntries={['/rooms/R1/media']}>
        <Routes><Route path="/rooms/:roomId/media" element={<MediaGallery />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText(/クレーム/));
    expect(await screen.findByAltText('タグの写真.jpg')).toBeTruthy();

    resolveSlow({ media: [item('old', '全部の写真.jpg')], has_more: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByAltText('全部の写真.jpg')).toBeNull();
    expect(screen.getByAltText('タグの写真.jpg')).toBeTruthy();
  });
});

/**
 * #496 タグの知らせを店 (messageStore) に反映する
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMessageStore } from '../src/stores/messageStore';

const msg = (id: string, tags: Array<Record<string, unknown>>) => ({ id, room_id: 'r1', sender_id: 'u1', content: id, type: 'text', created_at: '2026-10-04T00:00:00Z', tags }) as never;

describe('messageStore — タグ (#496)', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: [msg('m1', [{ id: 't1', name: 'TODO', is_done: false }]), msg('m2', [{ id: 't1', name: 'TODO' }, { id: 't2', name: '見積' }])] } as never);
  });

  it('★ updateTags はその投稿のタグだけを差し替える', () => {
    useMessageStore.getState().updateTags('m1', [{ id: 't1', name: 'TODO', is_done: true }] as never);
    const [m1, m2] = useMessageStore.getState().messages as Array<{ tags: Array<{ id: string; is_done?: boolean }> }>;
    expect(m1.tags).toEqual([{ id: 't1', name: 'TODO', is_done: true }]);
    expect(m2.tags.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('★ removeTag は、そのタグを全投稿から外す', () => {
    useMessageStore.getState().removeTag('t1');
    const [m1, m2] = useMessageStore.getState().messages as Array<{ tags: Array<{ id: string }> }>;
    expect(m1.tags).toEqual([]);
    expect(m2.tags.map((t) => t.id)).toEqual(['t2']);
  });
});

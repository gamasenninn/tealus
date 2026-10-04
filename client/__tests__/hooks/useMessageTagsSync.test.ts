/**
 * #496 タグの表示は、最初に受け取った値を持ち続けていた (useState の初期値だけ)。
 * 知らせで店の値が変わったら、表示も追従する
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
vi.mock('../../src/services/api', () => ({ api: { getMessageTags: vi.fn() } }));
import { useMessageTags, type TagEntry } from '../../src/hooks/useMessageTags';

describe('useMessageTags (#496)', () => {
  it('★★ 渡されるタグが変わったら、表示のタグも変わる', () => {
    const first = [{ id: 't1', tag_id: 't1', name: 'TODO', is_done: false }] as TagEntry[];
    const { result, rerender } = renderHook(({ tags }) => useMessageTags('m1', tags), { initialProps: { tags: first } });
    expect(result.current.tags[0].is_done).toBe(false);

    rerender({ tags: [{ id: 't1', tag_id: 't1', name: 'TODO', is_done: true }] as TagEntry[] });
    expect(result.current.tags[0].is_done).toBe(true);
  });
});

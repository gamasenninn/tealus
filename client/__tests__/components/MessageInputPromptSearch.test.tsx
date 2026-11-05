/**
 * 指示の履歴の絞り込みは本体で探す (改善ループ 37)
 *
 * 以前は返ってきた 30 件の中だけを文字で絞っていたので、31 本目以降・200 件より前の指示は
 * `/` のあとに打って探しても無いように見えた (11-02 の業務メモ/小野さん: 286 本、200 件は 06-07 まで)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const getPromptHistory = vi.fn();
vi.mock('../../src/services/api', () => ({ api: {
  getCcProjects: vi.fn().mockResolvedValue({ projects: [] }),
  getPromptHistory: (...a: unknown[]) => getPromptHistory(...a),
  getMessages: vi.fn().mockResolvedValue({ messages: [] }),
  request: vi.fn().mockResolvedValue({}),
} }));
vi.mock('../../src/services/socket', () => ({ getSocket: () => ({ emit: vi.fn() }) }));
vi.mock('../../src/stores/agentStore', () => ({
  useAgentStore: () => ({ assistantUserId: 'bot', assistantName: 'アシスタント', fetchIdentity: vi.fn() }),
}));
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u1', role: 'user' } }) }));

import MessageInput from '../../src/components/chat/MessageInput';
import { useRoomStore } from '../../src/stores/roomStore';

const textarea = () => document.querySelector('textarea.message-input-text') as HTMLTextAreaElement;
const old = { message_id: 'm-old', target: 'アシスタント', body: '古い棚卸しの手順', content: '@アシスタント 古い棚卸しの手順', holes: [], created_at: '2026-01-01T00:00:00Z' };

describe('MessageInput — 指示の履歴を本体で絞り込む', () => {
  beforeEach(() => {
    getPromptHistory.mockReset().mockImplementation((_r: string, _t: string[], _l?: number, q?: string) =>
      Promise.resolve({ items: q ? [old] : [], pinned: [], target_counts: { アシスタント: 3 } }));
    useRoomStore.setState({ members: [{ user_id: 'bot' }] } as never);
  });

  it('★ `/` のあとに打った文字を本体へ渡し、返ってきた指示を出す', async () => {
    render(<MessageInput roomId="r1" />);
    fireEvent.change(textarea(), { target: { value: '/' } });
    fireEvent.change(textarea(), { target: { value: '/棚卸' } });
    await waitFor(() => expect(getPromptHistory).toHaveBeenCalledWith('r1', ['アシスタント'], 30, '棚卸'));
    await waitFor(() => expect(document.body.textContent).toContain('古い棚卸しの手順'));
  });

  // ★ 改善ループ 39: 絞り込み中に部屋を移ると、移った先の一覧が空のまま残った
  //   (部屋替えで一覧を捨てたあと、同じ文字なので「もう探した」と見なして探し直さなかった)
  it('★ 絞り込み中に部屋を移ったら、移った先の部屋で探し直す', async () => {
    const view = render(<MessageInput roomId="r1" />);
    fireEvent.change(textarea(), { target: { value: '/' } });
    fireEvent.change(textarea(), { target: { value: '/棚卸' } });
    await waitFor(() => expect(getPromptHistory).toHaveBeenCalledWith('r1', ['アシスタント'], 30, '棚卸'));
    view.rerender(<MessageInput roomId="r2" />);
    await waitFor(() => expect(getPromptHistory).toHaveBeenCalledWith('r2', ['アシスタント'], 30, '棚卸'));
    await waitFor(() => expect(document.body.textContent).toContain('古い棚卸しの手順'));
  });

  it('打っていないときは q を渡さない (今までどおり)', async () => {
    render(<MessageInput roomId="r1" />);
    await waitFor(() => expect(getPromptHistory).toHaveBeenCalled());
    expect(getPromptHistory.mock.calls.every((c) => c[3] === undefined)).toBe(true);
  });
});

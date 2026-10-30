/**
 * アシスタントの名前を取れなかったら、次に部屋を開いたとき取り直す (2026-10-30 改善ループ 26 回目)
 * ★ 失敗 (agent-server の再起動中など) でも「取った」印を立てたままにしていて、
 *   🤖 ボタン・宛先候補の @アシスタント が、読み込み直すまで出なかった (agent-server の起動は 30 日で 39 回)
 */
import { describe, it, expect, vi } from 'vitest';

const getAgentIdentity = vi.fn();
vi.mock('../src/services/api', () => ({ api: { getAgentIdentity: () => getAgentIdentity() } }));
const { useAgentStore } = await import('../src/stores/agentStore');

describe('agentStore.fetchIdentity', () => {
  it('★★ 取れなかった (user_id が null) ら、次の呼び出しで取り直す。取れたら以後は取りに行かない', async () => {
    getAgentIdentity.mockResolvedValueOnce({ user_id: null, display_name: null })
      .mockResolvedValue({ user_id: 'a1', display_name: 'アシスタント' });
    await useAgentStore.getState().fetchIdentity();
    expect(useAgentStore.getState().assistantUserId).toBeNull();
    await useAgentStore.getState().fetchIdentity();
    expect(useAgentStore.getState().assistantUserId).toBe('a1');
    await useAgentStore.getState().fetchIdentity();
    expect(getAgentIdentity).toHaveBeenCalledTimes(2);
  });
});

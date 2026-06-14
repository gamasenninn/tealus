/**
 * #295: デリゲーター (委譲オーケストレーション) テスト (Red)
 *
 * 責務: `%` 委譲 1 件を実行する。
 *   1. delegationChain.startChain で chain を起動 (4 段ガード)。blocked なら委譲元へ理由を返す。
 *   2. 委譲先 agent を runAgent(targetRoomId, task) で実行し最終本文を得る (agent は委譲を意識しない)。
 *   3. 結果を **委譲元のみ** に postToRoom する (委譲先には残さない = 計算ノードに徹する)。
 *
 * 副作用 (agent 実行 / room 投稿) は deps で注入し、実 SDK 無しで test する。
 */
const chain = require('../../src/webhook/delegationChain');
const { handleDelegation } = require('../../src/webhook/delegator');

function makeDeps(overrides = {}) {
  return {
    runAgent: jest.fn().mockResolvedValue('売上は前年比110%です'),
    postToRoom: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('delegator.handleDelegation (#295)', () => {
  beforeEach(() => {
    chain._reset();
    chain.configure(chain.DEFAULT_LIMITS);
  });

  test('正常系: 委譲先 agent を task で実行し、結果を委譲元のみへ返す', async () => {
    const deps = makeDeps();
    const r = await handleDelegation(
      { originRoomId: 'A', targetRoom: { id: 'B', name: '社内DB検索' }, task: '売上を集計して' },
      deps
    );

    expect(r.ok).toBe(true);
    // 委譲先 agent は task をそのまま受け取る (委譲を意識しない)
    expect(deps.runAgent).toHaveBeenCalledWith('B', '売上を集計して');
    // 委譲元のみへ投稿
    expect(deps.postToRoom).toHaveBeenCalledTimes(1);
    const [postedRoomId, postedText] = deps.postToRoom.mock.calls[0];
    expect(postedRoomId).toBe('A');
    expect(postedText).toContain('売上は前年比110%です');
    expect(postedText).toContain('社内DB検索'); // 出所の明示
  });

  test('委譲先 room には一切 postToRoom しない (計算に徹する)', async () => {
    const deps = makeDeps();
    await handleDelegation(
      { originRoomId: 'A', targetRoom: { id: 'B', name: '社内DB検索' }, task: 't' },
      deps
    );
    const targetPosts = deps.postToRoom.mock.calls.filter(([rid]) => rid === 'B');
    expect(targetPosts).toHaveLength(0);
  });

  test('chain ガードで blocked (自室委譲) → agent 実行せず委譲元へ理由を返す', async () => {
    const deps = makeDeps();
    const r = await handleDelegation(
      { originRoomId: 'A', targetRoom: { id: 'A', name: 'テスト' }, task: 't' },
      deps
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('cycle');
    expect(deps.runAgent).not.toHaveBeenCalled();
    // 委譲元へ何か通知する (silent fail 禁止)
    expect(deps.postToRoom).toHaveBeenCalledTimes(1);
    const [rid, text] = deps.postToRoom.mock.calls[0];
    expect(rid).toBe('A');
    expect(text).toContain('委譲');
  });

  test('委譲先 agent が throw → 委譲元へエラー通知し ok:false', async () => {
    const deps = makeDeps({ runAgent: jest.fn().mockRejectedValue(new Error('boom')) });
    const r = await handleDelegation(
      { originRoomId: 'A', targetRoom: { id: 'B', name: '社内DB検索' }, task: 't' },
      deps
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('agent_error');
    expect(deps.postToRoom).toHaveBeenCalledTimes(1);
    expect(deps.postToRoom.mock.calls[0][0]).toBe('A');
  });

  test('委譲先 agent が空応答 → 委譲元へ通知し ok:false', async () => {
    const deps = makeDeps({ runAgent: jest.fn().mockResolvedValue('   ') });
    const r = await handleDelegation(
      { originRoomId: 'A', targetRoom: { id: 'B', name: '社内DB検索' }, task: 't' },
      deps
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty_response');
    expect(deps.postToRoom).toHaveBeenCalledTimes(1);
    expect(deps.postToRoom.mock.calls[0][0]).toBe('A');
  });
});

/**
 * #295: 委譲チェーン (予算付き封筒 + 4 段ガード) テスト (Red)
 *
 * 設計:
 *   - startChain: human 起点の root 委譲。新 chainId を採番し封筒を生成、共有予算を 1 消費。
 *   - extendChain: chain 内の子委譲 (agent が `%` を吐いた場合)。4 段ガードを通れば
 *     子封筒を返し共有予算を 1 消費。
 *   - 封筒 (envelope): { chainId, nodeId, hop, visited:[roomId...], originRoomId, targetRoomId, task }
 *   - ガード reason: 'cycle' | 'max_depth' | 'fanout_exceeded' | 'budget_exhausted'
 *   - 悪意ある無限増殖対策の肝: agent は `%` 平文を吐くだけで封筒に触れない。
 *     封筒 (chainId/予算/visited/hop) はこのモジュールが生成・伝播するため、
 *     大量の `%` を吐かせても全て同じ chainId を継承し同じ共有予算 K を食い潰すだけ。
 */
const chain = require('../../src/webhook/delegationChain');

describe('delegationChain (#295 予算付き封筒 + 4 段ガード)', () => {
  beforeEach(() => {
    chain._reset();
    chain.configure(chain.DEFAULT_LIMITS);
  });

  describe('startChain (root 委譲)', () => {
    test('封筒を生成する: hop=0, visited=[origin,target], task 保持', () => {
      const r = chain.startChain({ originRoomId: 'A', targetRoomId: 'B', task: '集計して' });
      expect(r.ok).toBe(true);
      expect(r.envelope.hop).toBe(0);
      expect(r.envelope.visited).toEqual(['A', 'B']);
      expect(r.envelope.originRoomId).toBe('A');
      expect(r.envelope.targetRoomId).toBe('B');
      expect(r.envelope.task).toBe('集計して');
      expect(typeof r.envelope.chainId).toBe('string');
      expect(r.envelope.chainId.length).toBeGreaterThan(0);
      expect(typeof r.envelope.nodeId).toBe('string');
    });

    test('2 回呼ぶと別 chainId になる', () => {
      const a = chain.startChain({ originRoomId: 'A', targetRoomId: 'B', task: 't' });
      const b = chain.startChain({ originRoomId: 'A', targetRoomId: 'C', task: 't' });
      expect(a.envelope.chainId).not.toBe(b.envelope.chainId);
    });

    test('自室委譲 (origin === target) は cycle で弾く', () => {
      const r = chain.startChain({ originRoomId: 'A', targetRoomId: 'A', task: 't' });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('cycle');
    });
  });

  describe('extendChain (子委譲)', () => {
    test('正常: hop が増え visited に target が追加され chainId は継承', () => {
      const root = chain.startChain({ originRoomId: 'A', targetRoomId: 'B', task: 't' }).envelope;
      const r = chain.extendChain(root, { targetRoomId: 'C', task: 't2' });
      expect(r.ok).toBe(true);
      expect(r.envelope.hop).toBe(1);
      expect(r.envelope.visited).toEqual(['A', 'B', 'C']);
      expect(r.envelope.chainId).toBe(root.chainId);
      expect(r.envelope.nodeId).not.toBe(root.nodeId);
    });

    test('cycle: visited に既出の room へは委譲拒否', () => {
      const root = chain.startChain({ originRoomId: 'A', targetRoomId: 'B', task: 't' }).envelope;
      expect(chain.extendChain(root, { targetRoomId: 'A', task: 't' }).reason).toBe('cycle');
      expect(chain.extendChain(root, { targetRoomId: 'B', task: 't' }).reason).toBe('cycle');
    });

    test('max_depth: hop が maxDepth を超えたら拒否', () => {
      chain.configure({ maxDepth: 2, maxChainBudget: 100, maxFanoutPerTurn: 100 });
      const root = chain.startChain({ originRoomId: 'A', targetRoomId: 'B', task: 't' }).envelope; // hop0
      const c1 = chain.extendChain(root, { targetRoomId: 'C', task: 't' }); // hop1
      expect(c1.ok).toBe(true);
      const c2 = chain.extendChain(c1.envelope, { targetRoomId: 'D', task: 't' }); // hop2
      expect(c2.ok).toBe(true);
      const c3 = chain.extendChain(c2.envelope, { targetRoomId: 'E', task: 't' }); // hop3 > 2
      expect(c3.ok).toBe(false);
      expect(c3.reason).toBe('max_depth');
    });

    test('fanout_exceeded: 同一 parent から maxFanoutPerTurn を超える分岐を拒否', () => {
      chain.configure({ maxDepth: 100, maxChainBudget: 100, maxFanoutPerTurn: 2 });
      const root = chain.startChain({ originRoomId: 'A', targetRoomId: 'B', task: 't' }).envelope;
      expect(chain.extendChain(root, { targetRoomId: 'C', task: 't' }).ok).toBe(true);
      expect(chain.extendChain(root, { targetRoomId: 'D', task: 't' }).ok).toBe(true);
      const third = chain.extendChain(root, { targetRoomId: 'E', task: 't' });
      expect(third.ok).toBe(false);
      expect(third.reason).toBe('fanout_exceeded');
    });

    test('budget_exhausted: chain 全体の委譲総数が maxChainBudget に達したら拒否 (木の形に依らない)', () => {
      chain.configure({ maxDepth: 100, maxChainBudget: 5, maxFanoutPerTurn: 100 });
      const root = chain.startChain({ originRoomId: 'A', targetRoomId: 'B', task: 't' }).envelope; // spent=1
      // root から別 room へ 4 回までは OK (spent 2,3,4,5)、5 回目で予算切れ
      const targets = ['C', 'D', 'E', 'F'];
      targets.forEach((t) => {
        expect(chain.extendChain(root, { targetRoomId: t, task: 't' }).ok).toBe(true);
      });
      const over = chain.extendChain(root, { targetRoomId: 'G', task: 't' });
      expect(over.ok).toBe(false);
      expect(over.reason).toBe('budget_exhausted');
    });

    test('予算は枝をまたいで共有される (扇状増殖でも総量で止まる)', () => {
      chain.configure({ maxDepth: 100, maxChainBudget: 3, maxFanoutPerTurn: 100 });
      const root = chain.startChain({ originRoomId: 'A', targetRoomId: 'B', task: 't' }).envelope; // spent=1
      const c = chain.extendChain(root, { targetRoomId: 'C', task: 't' }); // spent=2
      expect(c.ok).toBe(true);
      const d = chain.extendChain(c.envelope, { targetRoomId: 'D', task: 't' }); // spent=3
      expect(d.ok).toBe(true);
      // 別枝 (root の子) でも同じ予算を共有 → もう取れない
      const e = chain.extendChain(root, { targetRoomId: 'E', task: 't' });
      expect(e.ok).toBe(false);
      expect(e.reason).toBe('budget_exhausted');
    });
  });

  test('未知 chainId の封筒 (偽造 / reset 後の孤児) への extend は拒否', () => {
    const fake = {
      chainId: 'nonexistent',
      nodeId: 'x',
      hop: 0,
      visited: ['A', 'B'],
      originRoomId: 'A',
      targetRoomId: 'B',
      task: 't',
    };
    const r = chain.extendChain(fake, { targetRoomId: 'C', task: 't' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown_chain');
  });

  test('_reset で chain 状態がクリアされる', () => {
    chain.configure({ maxDepth: 100, maxChainBudget: 2, maxFanoutPerTurn: 100 });
    const root = chain.startChain({ originRoomId: 'A', targetRoomId: 'B', task: 't' }).envelope;
    expect(chain.extendChain(root, { targetRoomId: 'C', task: 't' }).ok).toBe(true);
    expect(chain.extendChain(root, { targetRoomId: 'D', task: 't' }).ok).toBe(false); // budget=2 で切れ
    chain._reset();
    // reset 後は同じ封筒でも別 chain として budget が復活しない (chain 状態消失) ため
    // extend は未知 chain 扱い。ここでは新しく start からやり直せることを確認。
    const root2 = chain.startChain({ originRoomId: 'A', targetRoomId: 'B', task: 't' });
    expect(root2.ok).toBe(true);
  });
});

/**
 * cc-queue 購読者レジストリ (#214) unit test
 *
 * scope: project ごとの購読者管理と、★ 認可 = 接続者が member のルームのイベントだけを配る。
 *
 * ★ なぜ認可がここに要るか (#214 で判明):
 *   beacon を書くのは agent-server の bot、消費して返信するのは CC セッションの bot で
 *   **別 principal**。実データでも、agent-server の bot は member だが CC 側の bot は
 *   member でない DM が beacon に入っていた (返信しようとすると bot API が 403)。
 *   購読者ごとの allowedRooms で絞り、**消費者が実際に行動できる範囲に揃える**。
 */
// logger をモックしないと、テストの購読者が **本番の agent-server ログ** に書き込む
// (実際に `rooms=1` / `project=organon` 等のテストデータが本番ログに混入した)
jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));

import {
  addSubscriber, removeSubscriber, publish, subscriberCount,
  type CcSubscriber,
} from '../../src/webhook/ccSubscribers.mts';

/** res.write を記録するだけの最小 fake */
function fakeRes() {
  const written: string[] = [];
  return {
    written,
    write: (chunk: string) => { written.push(chunk); return true; },
    payloads: () => written.map((l) => JSON.parse(l.trim())),
  };
}

/** テスト用の購読者を作る。afterEach で確実に落とすため作ったものを覚えておく */
const created: CcSubscriber[] = [];
function makeSub(project: string, rooms: string[]) {
  const res = fakeRes();
  const s: CcSubscriber = { project, allowedRooms: new Set(rooms), sink: res };
  created.push(s);
  return { s, res };
}

afterEach(() => {
  for (const s of created) removeSubscriber(s);
  created.length = 0;
});

const EV = (roomId: string, id = 'm1') => ({ id, room_id: roomId, room_name: 'r', content: 'hi', type: 'text' });

describe('ccSubscribers — 登録と解除', () => {
  it('登録すると数に反映され、解除すると戻る', () => {
    const { s } = makeSub('tealus', ['r1']);
    expect(subscriberCount('tealus')).toBe(0);
    addSubscriber(s);
    expect(subscriberCount('tealus')).toBe(1);
    removeSubscriber(s);
    expect(subscriberCount('tealus')).toBe(0);
  });

  it('同じ project に複数の購読者が並存できる', () => {
    const a = makeSub('tealus', ['r1']);
    const b = makeSub('tealus', ['r1']);
    addSubscriber(a.s);
    addSubscriber(b.s);
    expect(subscriberCount('tealus')).toBe(2);
  });

  it('未登録の購読者を解除しても壊れない', () => {
    const { s } = makeSub('tealus', ['r1']);
    expect(() => removeSubscriber(s)).not.toThrow();
    expect(subscriberCount('tealus')).toBe(0);
  });

  it('未知の project の購読者数は 0', () => {
    expect(subscriberCount('does-not-exist')).toBe(0);
  });
});

describe('ccSubscribers — publish の配信と認可', () => {
  it('★ allowedRooms に含まれるルームのイベントだけ届く', () => {
    const { s, res } = makeSub('tealus', ['r1', 'r2']);
    addSubscriber(s);

    publish('tealus', EV('r1', 'a'));
    publish('tealus', EV('r9', 'b'));   // ★ member でないルーム
    publish('tealus', EV('r2', 'c'));

    expect(res.payloads().map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('★ 実データで見つかった形: 他人の DM は member でない購読者に届かない', () => {
    // agent-server の bot は member なので beacon に載るが、CC 側の bot は member でない
    const DM = '4df09fa9-9433-4dcf-9cf8-3de4e8ead951';
    const { s, res } = makeSub('tealus', ['ai-room']);
    addSubscriber(s);

    publish('tealus', EV(DM, 'dm'));

    expect(res.written).toHaveLength(0);
  });

  it('別 project の購読者には届かない', () => {
    const t = makeSub('tealus', ['r1']);
    const o = makeSub('organon', ['r1']);
    addSubscriber(t.s);
    addSubscriber(o.s);

    publish('tealus', EV('r1', 'x'));

    expect(t.res.payloads().map((p) => p.id)).toEqual(['x']);
    expect(o.res.written).toHaveLength(0);
  });

  it('同 project でも購読者ごとの allowedRooms で判定される', () => {
    const a = makeSub('tealus', ['r1']);
    const b = makeSub('tealus', ['r2']);
    addSubscriber(a.s);
    addSubscriber(b.s);

    publish('tealus', EV('r1', 'only-a'));

    expect(a.res.payloads().map((p) => p.id)).toEqual(['only-a']);
    expect(b.res.written).toHaveLength(0);
  });

  it('room_id が無い payload は誰にも配らない (安全側に倒す)', () => {
    const { s, res } = makeSub('tealus', ['r1']);
    addSubscriber(s);

    publish('tealus', { id: 'no-room', content: 'x' });

    expect(res.written).toHaveLength(0);
  });

  it('購読者ゼロでも publish は例外を投げない (file beacon は既に書けている)', () => {
    expect(() => publish('tealus', EV('r1'))).not.toThrow();
  });

  it('NDJSON = 1 イベント 1 行、末尾に改行', () => {
    const { s, res } = makeSub('tealus', ['r1']);
    addSubscriber(s);
    publish('tealus', EV('r1', 'z'));
    expect(res.written[0]).toBe(JSON.stringify(EV('r1', 'z')) + '\n');
  });
});

describe('ccSubscribers — 切断済み購読者の扱い', () => {
  /** write が必ず投げる購読者 (切断済み接続の模擬) */
  function makeBrokenSub(project: string, rooms: string[]) {
    const s: CcSubscriber = {
      project,
      allowedRooms: new Set(rooms),
      sink: { write: () => { throw new Error('EPIPE'); } },
    };
    created.push(s);
    return s;
  }

  it('★ write が投げる購読者がいても、他の購読者への配信は続く', () => {
    const broken = makeBrokenSub('tealus', ['r1']);
    const ok = makeSub('tealus', ['r1']);
    addSubscriber(broken);
    addSubscriber(ok.s);

    expect(() => publish('tealus', EV('r1', 'survive'))).not.toThrow();
    expect(ok.res.payloads().map((p) => p.id)).toEqual(['survive']);
  });

  it('★ write が投げた購読者は登録から外れる (切断済みを溜めない)', () => {
    const broken = makeBrokenSub('tealus', ['r1']);
    addSubscriber(broken);
    expect(subscriberCount('tealus')).toBe(1);

    publish('tealus', EV('r1'));

    expect(subscriberCount('tealus')).toBe(0);
  });
});

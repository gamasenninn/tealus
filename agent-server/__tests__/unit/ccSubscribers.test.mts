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
  broadcastControl, broadcastShutdown, broadcastBye,
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

// ---------------------------------------------------------------------------
// #365 計画的な停止の予告 (`__bye`)
//
// ★ なぜ要るか: 再起動はバグ修正のたびに起きる。人が毎回予告する運用は
//   **忘れるようになった時点で、本当に必要な場面でも使われなくなる**。
//   情報を持っているサーバが自分で予告すれば、覚えておく必要が消える。
//
// ★ 制御メッセージは room に属さないので publish() では送れない
//   (publish は room_id が無い payload を捨てる)。専用の経路が要る。
// ---------------------------------------------------------------------------
describe('broadcastControl — #365 制御メッセージの一斉送信', () => {
  it('★ room に関係なく全購読者に届く', () => {
    const a = makeSub('tealus', ['r1']);
    const b = makeSub('tealus', ['r9']);   // ★ 全く別の room だけの購読者
    addSubscriber(a.s);
    addSubscriber(b.s);

    broadcastControl('tealus', { __bye: { reason: 'shutdown', expect_back_ms: 30000 } });

    for (const r of [a.res, b.res]) {
      expect(r.written).toHaveLength(1);
      expect(JSON.parse(r.written[0].trim())).toEqual({ __bye: { reason: 'shutdown', expect_back_ms: 30000 } });
    }
  });

  it('別 project の購読者には届かない', () => {
    const t = makeSub('tealus', ['r1']);
    const o = makeSub('organon', ['r1']);
    addSubscriber(t.s);
    addSubscriber(o.s);

    broadcastControl('tealus', { __bye: { reason: 'shutdown' } });

    expect(t.res.written).toHaveLength(1);
    expect(o.res.written).toHaveLength(0);
  });

  it('NDJSON = 1 行 + 改行', () => {
    const { s, res } = makeSub('tealus', ['r1']);
    addSubscriber(s);
    broadcastControl('tealus', { __bye: { reason: 'shutdown' } });
    expect(res.written[0]).toBe('{"__bye":{"reason":"shutdown"}}' + '\n');
  });

  it('購読者ゼロでも例外を投げない', () => {
    expect(() => broadcastControl('tealus', { __bye: {} })).not.toThrow();
  });

  it('★ write が投げても他の購読者への送信は続く (停止時なので特に重要)', () => {
    const broken: CcSubscriber = {
      project: 'tealus', allowedRooms: new Set(['r1']),
      sink: { write: () => { throw new Error('EPIPE'); } },
    };
    created.push(broken);
    const ok = makeSub('tealus', ['r1']);
    addSubscriber(broken);
    addSubscriber(ok.s);

    expect(() => broadcastControl('tealus', { __bye: {} })).not.toThrow();
    expect(ok.res.written).toHaveLength(1);
  });
});

describe('broadcastShutdown — #365 全 project への停止予告', () => {
  it('★ project を問わず全購読者に予告を送る', () => {
    const t = makeSub('tealus', ['r1']);
    const o = makeSub('organon', ['r2']);
    addSubscriber(t.s);
    addSubscriber(o.s);

    broadcastShutdown(30000);

    for (const r of [t.res, o.res]) {
      const msg = JSON.parse(r.written[0].trim());
      expect(msg.__bye.reason).toBe('shutdown');
      expect(msg.__bye.expect_back_ms).toBe(30000);
    }
  });

  it('購読者が一人もいなくても例外を投げない (停止処理を阻害しない)', () => {
    expect(() => broadcastShutdown(30000)).not.toThrow();
  });

  it('★ 出力が従来と 1 バイトも変わらない (broadcastBye 切り出しの回帰止め)', () => {
    const { s, res } = makeSub('tealus', ['r1']);
    addSubscriber(s);
    broadcastShutdown(30000);
    expect(res.written[0]).toBe('{"__bye":{"reason":"shutdown","expect_back_ms":30000}}' + '\n');
  });
});

// ---------------------------------------------------------------------------
// #368 本体サーバ (中継) の再起動を予告する
//
// ★ 本体サーバは「自分が落ちる」を知っているが購読者を知らない。agent-server は
//   その逆。情報と配る能力が別プロセスにあるので、本体から一段渡して配らせる。
//   reason を分けるのは、購読者側の記録に「何で切れたか」を残すため
//   (SKILL は `{"__bye"` の接頭辞一致 + expect_back_ms しか見ないので、
//    新しい reason 値でも既存クライアントはそのまま扱える = 再配布不要)。
// ---------------------------------------------------------------------------
describe('broadcastBye — #368 理由つきの予告', () => {
  it('★ 指定した reason で全 project の購読者に届く', () => {
    const t = makeSub('tealus', ['r1']);
    const o = makeSub('organon', ['r2']);
    addSubscriber(t.s);
    addSubscriber(o.s);

    broadcastBye('gateway_restart', 30000);

    for (const r of [t.res, o.res]) {
      const msg = JSON.parse(r.written[0].trim());
      expect(msg.__bye.reason).toBe('gateway_restart');
      expect(msg.__bye.expect_back_ms).toBe(30000);
    }
  });

  it('NDJSON = 1 行 + 改行 (キーの順序も固定)', () => {
    const { s, res } = makeSub('tealus', ['r1']);
    addSubscriber(s);
    broadcastBye('gateway_restart', 5000);
    expect(res.written[0]).toBe('{"__bye":{"reason":"gateway_restart","expect_back_ms":5000}}' + '\n');
  });

  it('購読者ゼロでも例外を投げない (停止処理を阻害しない)', () => {
    expect(() => broadcastBye('gateway_restart', 30000)).not.toThrow();
  });

  it('★ 送信件数を返す (呼び出し側が「誰にも届いていない」を判別できる)', () => {
    expect(broadcastBye('gateway_restart', 30000)).toBe(0);
    const { s } = makeSub('tealus', ['r1']);
    addSubscriber(s);
    expect(broadcastBye('gateway_restart', 30000)).toBe(1);
  });
});

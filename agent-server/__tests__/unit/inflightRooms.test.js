/**
 * #292 SPIKE: in-flight rooms tracker テスト
 */
const inflightRooms = require('../../src/webhook/inflightRooms');

describe('inflightRooms (#292 SPIKE)', () => {
  beforeEach(() => {
    inflightRooms._reset();
  });

  test('add した room は isInflight=true', () => {
    inflightRooms.add('roomA');
    expect(inflightRooms.isInflight('roomA')).toBe(true);
  });

  test('未 add の room は isInflight=false', () => {
    expect(inflightRooms.isInflight('roomX')).toBe(false);
  });

  test('release 直後は遅延前なのでまだ isInflight=true', () => {
    inflightRooms.add('roomB');
    inflightRooms.release('roomB', 1000);
    expect(inflightRooms.isInflight('roomB')).toBe(true);
  });

  test('release の遅延を抜けると isInflight=false', async () => {
    inflightRooms.add('roomC');
    inflightRooms.release('roomC', 10);
    await new Promise((r) => setTimeout(r, 30));
    expect(inflightRooms.isInflight('roomC')).toBe(false);
  });

  test('ref-count: 2 回 add したら 1 回 release ではまだ in-flight', async () => {
    inflightRooms.add('roomD');
    inflightRooms.add('roomD');
    inflightRooms.release('roomD', 10);
    await new Promise((r) => setTimeout(r, 30));
    expect(inflightRooms.isInflight('roomD')).toBe(true);
    inflightRooms.release('roomD', 10);
    await new Promise((r) => setTimeout(r, 30));
    expect(inflightRooms.isInflight('roomD')).toBe(false);
  });

  test('null / undefined roomId は no-op', () => {
    expect(() => inflightRooms.add(null)).not.toThrow();
    expect(() => inflightRooms.release(undefined)).not.toThrow();
    expect(inflightRooms.isInflight(null)).toBe(false);
  });
});

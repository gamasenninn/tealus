/**
 * #292 SPIKE safety net: botSendThrottle テスト
 */
const throttle = require('../../src/lib/botSendThrottle');

describe('botSendThrottle (#292 SPIKE safety net)', () => {
  beforeEach(() => {
    throttle._reset();
  });

  test('閾値以下なら ok=true、tripped=false', () => {
    for (let i = 0; i < throttle.SPIKE_TRIP_THRESHOLD - 1; i++) {
      const r = throttle.checkAndRecord();
      expect(r.ok).toBe(true);
      expect(r.justTripped).toBe(false);
    }
    expect(throttle.isSpikeTripped()).toBe(false);
  });

  test('SPIKE_TRIP_THRESHOLD 到達で justTripped=true → 以後 isSpikeTripped=true', () => {
    for (let i = 0; i < throttle.SPIKE_TRIP_THRESHOLD - 1; i++) {
      throttle.checkAndRecord();
    }
    const tripping = throttle.checkAndRecord();
    expect(tripping.ok).toBe(true);
    expect(tripping.justTripped).toBe(true);
    expect(throttle.isSpikeTripped()).toBe(true);

    // 後続 call は justTripped=false (= 初回のみ true)
    const after = throttle.checkAndRecord();
    expect(after.justTripped).toBe(false);
  });

  test('HARD_CAP 到達で ok=false (= 送信 reject)', () => {
    for (let i = 0; i < throttle.HARD_CAP; i++) {
      const r = throttle.checkAndRecord();
      expect(r.ok).toBe(true);
    }
    const rejected = throttle.checkAndRecord();
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('hard-cap');
  });

  test('window 経過後 prune される (= 古い entry が消える)', async () => {
    const origNow = Date.now;
    let now = 1000000;
    Date.now = () => now;
    try {
      for (let i = 0; i < 5; i++) throttle.checkAndRecord();
      expect(throttle.getStats().currentWindowCount).toBe(5);

      // window を超える時間 advance
      now += throttle.WINDOW_MS + 1000;
      const r = throttle.checkAndRecord();
      // 古い 5 件は prune、新 1 件のみ残る
      expect(r.windowCount).toBe(1);
    } finally {
      Date.now = origNow;
    }
  });

  test('_reset でクリアされる', () => {
    for (let i = 0; i < throttle.SPIKE_TRIP_THRESHOLD; i++) throttle.checkAndRecord();
    expect(throttle.isSpikeTripped()).toBe(true);

    throttle._reset();
    expect(throttle.isSpikeTripped()).toBe(false);
    expect(throttle.getStats().currentWindowCount).toBe(0);
  });

  test('getStats は閾値と現在値を返す', () => {
    throttle.checkAndRecord();
    const s = throttle.getStats();
    expect(s.windowMs).toBe(throttle.WINDOW_MS);
    expect(s.spikeTripThreshold).toBe(throttle.SPIKE_TRIP_THRESHOLD);
    expect(s.hardCap).toBe(throttle.HARD_CAP);
    expect(s.currentWindowCount).toBe(1);
  });
});

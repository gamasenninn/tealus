/**
 * ルームトリガーが生きているかに気づく口 (2026-09-21)。
 *
 * ★★★★ なぜ要るか: 2026-09-21 に、**正常に動いているトリガーが「壊れている」と見えた**。
 * ```
 *   実際  11:23 / 13:23 / 15:23 に発火していた (120 分間隔のとおり)
 *   見え方 「写真があるのに動いていない」 ← ★ 間隔待ちの 46 分がそう見えた
 *   確かめ方 サーバログを grep するしかなかった
 * ```
 * ★ 同じ日に **同じ形**が 3 件出ている —— ★★ 置いたものが生きているかを見る口が無い:
 * ```
 *   raw_flow_watch  docstring が約束したログが 未実装だった
 *   report/tools    移した翌日まで 5 本 動かないままだった
 *   room-triggers   動いていたのに 壊れていると見えた
 * ```
 *
 * ★★★ **停滞の閾値は置かない。** 撃っていないことは異常とは限らない
 * (材料が無ければ撃たないのが正しい)。★ 閾値を置くと、定休や閑散日に誤報する
 * —— #441 で同じ罠を踏みかけている。**warn にするのは「見に行けなかったとき」だけ。**
 */
import { describe, it, expect } from '@jest/globals';
import { judgeTriggerLiveness } from '../../src/lib/doctor.mts';

const NOW = new Date('2026-09-21T07:00:00Z'); // 16:00 JST

describe('judgeTriggerLiveness', () => {
  it('★ 有効なトリガーの最終発火を出す (info)', () => {
    const f = judgeTriggerLiveness({
      reachable: true,
      enabledIds: ['shuppin-shashin'],
      lastFired: { 'shuppin-shashin': new Date('2026-09-21T06:23:43Z') },
      now: NOW,
    });
    expect(f.level).toBe('info');
    expect(f.id).toBe('room-triggers');
    expect(f.detail).toContain('shuppin-shashin');
    expect(f.detail).toContain('2026-09-21');
  });

  it('★★ 一度も撃っていなくても warn にしない (材料が無ければ撃たないのが正しい)', () => {
    const f = judgeTriggerLiveness({
      reachable: true,
      enabledIds: ['shuppin-shashin', 'tsuwa-fix-candidates'],
      lastFired: { 'shuppin-shashin': new Date('2026-09-21T06:23:43Z') },
      now: NOW,
    });
    expect(f.level).toBe('info');
    expect(f.detail).toContain('tsuwa-fix-candidates');
    expect(f.detail).toMatch(/まだ|一度も/);
  });

  it('★ 有効なトリガーが 0 本なら その旨 (info)', () => {
    const f = judgeTriggerLiveness({ reachable: true, enabledIds: [], lastFired: {}, now: NOW });
    expect(f.level).toBe('info');
    expect(f.detail).toMatch(/0 本|ありません/);
  });

  it('★★★★ 設定を読めなかったら warn (★ 「有効 0 本」と混ぜない)', () => {
    const f = judgeTriggerLiveness({ reachable: true, enabledIds: null, lastFired: {}, now: NOW });
    expect(f.level).toBe('warn');
    expect(f.detail).not.toMatch(/0 本/);
  });

  it('★★★★ DB に届かなかったら warn (★ 「撃っていない」と混ぜない)', () => {
    const f = judgeTriggerLiveness({
      reachable: false,
      enabledIds: ['shuppin-shashin'],
      lastFired: {},
      now: NOW,
    });
    expect(f.level).toBe('warn');
    expect(f.detail).not.toMatch(/まだ 1 度も/);
  });

  it('★ 設定に無い id が DB に在っても、有効な分だけを並べる (★★ 止めたトリガーの残骸を数えない)', () => {
    const f = judgeTriggerLiveness({
      reachable: true,
      enabledIds: ['shuppin-shashin'],
      lastFired: {
        'shuppin-shashin': new Date('2026-09-21T06:23:43Z'),
        'mukashi-no-trigger': new Date('2026-08-01T00:00:00Z'),
      },
      now: NOW,
    });
    expect(f.level).toBe('info');
    expect(f.detail).not.toContain('mukashi-no-trigger');
  });

  it('★★ 経過時間を添える (★ 「いつ撃ったか」だけだと読む側が毎回引き算する)', () => {
    const f = judgeTriggerLiveness({
      reachable: true,
      enabledIds: ['shuppin-shashin'],
      lastFired: { 'shuppin-shashin': new Date('2026-09-21T06:23:43Z') },
      now: NOW,
    });
    expect(f.detail).toMatch(/分前|時間前|日前/);
  });
});

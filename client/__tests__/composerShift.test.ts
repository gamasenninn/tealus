/**
 * 11-28 利用者の案 A: マルチトークのパネルで入力欄を広げると、いちばん下の投稿が入力欄に隠れ、返事が書きにくい。
 * ★ いちばん下を見ているときに広げたら、トークを入力欄が重なる高さぶん上にずらす (最新が入力欄のすぐ上に見える)
 * ★ 上の方を読んでいる途中で広げたときは、今どおり重ねる (#513「見ていた位置がずれない」を守る)
 * ★ ずらしている間に入力欄の背が変わったら (行が増えた・返信先が付いた) ずらす量も合わせる。閉じたら 0
 */
import { describe, it, expect } from 'vitest';
import { composerShift } from '../src/utils/composerShift';

const bottom = { scrollHeight: 2000, scrollTop: 1500, clientHeight: 500 };   // いちばん下
const reading = { scrollHeight: 2000, scrollTop: 600, clientHeight: 500 };   // 上の方を読んでいる

describe('composerShift — 広げた入力欄の分だけトークをずらすか', () => {
  it('★★ いちばん下を見ているときに広げたら、重なる高さぶんずらす', () => {
    expect(composerShift(bottom, 140, 0)).toBe(140);
  });

  it('★ いちばん下の近く (100px 以内) も「下を見ている」に数える', () => {
    expect(composerShift({ ...bottom, scrollTop: 1420 }, 140, 0)).toBe(140);
  });

  it('★★ 上の方を読んでいる途中で広げたら、ずらさない (重ねる。見ていた位置がずれない)', () => {
    expect(composerShift(reading, 140, 0)).toBe(0);
  });

  it('★ ずらしている間に入力欄の背が変わったら、ずらす量も合わせる (位置によらず)', () => {
    expect(composerShift(reading, 220, 140)).toBe(220);
  });

  it('★ 閉じたら (重なり 0) 戻す', () => {
    expect(composerShift(bottom, 0, 140)).toBe(0);
  });

  it('重なりが負・数でないときは 0', () => {
    expect(composerShift(bottom, -10, 0)).toBe(0);
    expect(composerShift(bottom, Number.NaN, 0)).toBe(0);
  });
});

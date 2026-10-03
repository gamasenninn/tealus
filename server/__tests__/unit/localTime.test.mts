/**
 * #485-1 AI が読む時刻をサーバーの時間帯で添える
 *
 * ★ 朝礼の議事録が「02:29 投稿の動画から作成」と書いていた (実際は 11:29 JST)。
 *   API が created_at を UTC の ISO (`…Z`) だけで返し、AI がそれを変換せずに書き写していた。
 */
import { formatLocalTime } from '../../src/lib/localTime.mts';

describe('formatLocalTime', () => {
  const saved = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = saved;
  });

  it('既定は Asia/Tokyo で、時間帯の名前を添える (02:29Z → 11:29)', () => {
    delete process.env.APP_TIMEZONE;
    expect(formatLocalTime(new Date('2026-10-02T02:29:05.123Z'))).toBe('2026-10-02 11:29 (Asia/Tokyo)');
  });

  it('日付をまたぐ (15:30Z → 翌日 00:30)', () => {
    delete process.env.APP_TIMEZONE;
    expect(formatLocalTime(new Date('2026-10-02T15:30:00Z'))).toBe('2026-10-03 00:30 (Asia/Tokyo)');
  });

  it('APP_TIMEZONE で変えられる (採用者のため)', () => {
    process.env.APP_TIMEZONE = 'UTC';
    expect(formatLocalTime(new Date('2026-10-02T02:29:00Z'))).toBe('2026-10-02 02:29 (UTC)');
  });

  it('文字列 (pg の行が文字列で来た場合) も受け付ける', () => {
    delete process.env.APP_TIMEZONE;
    expect(formatLocalTime('2026-10-02T02:29:00.000Z')).toBe('2026-10-02 11:29 (Asia/Tokyo)');
  });

  it('★ 読めない時間帯の名前なら Asia/Tokyo に倒す (起動を落とさない・壊れた値を出さない)', () => {
    process.env.APP_TIMEZONE = 'Not/AZone';
    expect(formatLocalTime(new Date('2026-10-02T02:29:00Z'))).toBe('2026-10-02 11:29 (Asia/Tokyo)');
  });
});

/**
 * #485-1 時刻をサーバーの時間帯で読める形にする (`2026-10-02 11:29 (Asia/Tokyo)`)。
 *
 * ★ API の created_at は UTC の ISO (`…Z`) で、AI はそれを変換せずに書き写す。
 *   朝礼の議事録が「02:29 投稿の動画から作成」と書いていた (実際は 11:29 JST、9-21〜10-02 のすべて)。
 *   AI が読む API にこの形を添える。時間帯の名前も付けて、どこの時刻かを本文から分かるようにする。
 * ★ 時間帯は APP_TIMEZONE (既定 Asia/Tokyo)。読めない名前なら既定に倒す (壊れた値を出さない)。
 */
const DEFAULT_TZ = 'Asia/Tokyo';

function resolveTimeZone(): string {
  const tz = process.env.APP_TIMEZONE || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

export function formatLocalTime(value: Date | string): string {
  const tz = resolveTimeZone();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} (${tz})`;
}

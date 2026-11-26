/**
 * #476 日付へ飛ぶ: 見ている人の時差で、日・月の区切りを UTC の時刻にする。
 * 改善ループ 134 で routes/messages.mts から出した (中身は同じ)。DB も logger も読まない純粋なファイル
 * テスト: __tests__/unit/dayRange.test.mts、結合は messageDays
 *
 * ★ tz_offset は画面の Date.getTimezoneOffset() (UTC − 現地、分。日本なら -540)。
 *   日の区切りを見ている人の時刻に合わせる。現地の 0 時 = UTC の (0 時 + tz_offset 分)
 */
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAY_MS = 86_400_000;

export interface UtcRange { from: Date; to: Date }

/** tz_offset を分の整数で読む。時差は ±14 時間まで。読めなければ null */
export function parseTzOffset(v: unknown): number | null {
  if (typeof v !== 'string' || !/^-?\d+$/.test(v)) return null;
  const n = parseInt(v, 10);
  return Math.abs(n) <= 14 * 60 ? n : null;
}

/** 現地の y/m/d 0 時を UTC の Date にする */
function localMidnightUtc(y: number, m: number, d: number, tzOffset: number): Date {
  return new Date(Date.UTC(y, m - 1, d) + tzOffset * 60_000);
}

/** YYYY-MM の月の初めから次の月の初めまで。形が違えば null */
export function monthRangeUtc(month: string, tzOffset: number): UtcRange | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  return {
    from: localMidnightUtc(y, mo, 1, tzOffset),
    to: localMidnightUtc(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1, tzOffset),
  };
}

/** YYYY-MM-DD のその日 24 時間。形が違えば 'bad-format'、無い日 (2/30 など) は 'bad-date' */
export function dayRangeUtc(date: string, tzOffset: number): UtcRange | 'bad-format' | 'bad-date' {
  const d = DATE_RE.exec(date);
  if (!d) return 'bad-format';
  const y = Number(d[1]), mo = Number(d[2]), day = Number(d[3]);
  // ★ 2/30 のような無い日は 3/2 に化けるので、組み立て直して同じかを確かめる
  const check = new Date(Date.UTC(y, mo - 1, day));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== day) return 'bad-date';
  const from = localMidnightUtc(y, mo, day, tzOffset);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/**
 * 部屋の「人が直した例」を補正段の指示の前に載せる (docs/15、2026-11-22 利用者の発案)。
 *
 * 補正段 (organon モード) は辞書の全語を指示に並べて崩れを直させているが、人が直している崩れの多くは
 * 音が似ていない (呼び出しの名前が一般語・別の姓・外来語に聞き違えられる)。一方、聞き違いには部屋ごとの癖があり、
 * 同じ名前が同じ崩れ方で何度も人に直されている。そこで、その部屋で人が直した文字起こしを例として載せる。
 *
 * 実験 (2026-11-22、トランシーバー、時間で分けた 144 便): 人が直した崩れの直りが 8 → 29 / 105。
 *   直した例だけだと「例によく出る呼び出し先」へ寄せる誤りが出たので、人が呼びかけを変えなかった例も混ぜる
 *   (余計な語 26 → 21)。数字の詳細は docs/15 §5。
 *
 * 約束:
 *   - プログラムに語の一覧を持たない。例はその部屋のデータから選ぶ (docs/15 §7)
 *   - 例はその部屋の補正にだけ使う (他の部屋・ログ・外向きの応答に出さない、§6.1)
 *   - 「文脈が合うときだけ直す」のような全体を慎重にする文は入れない (別の実験で得が全部消えた)
 *
 * この下の選び方は純粋な関数。DB を読む部分は loadRoomExamples (下) に分けている (glossaryRanker と同じ分け方)。
 */
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';

/** 1 便: 版 1 の raw と AI の整形、人の最新版 (人が直していなければ null) */
export interface ExampleSourceRow {
  id: string;
  created_at: string;
  raw: string;
  ai: string;
  human: string | null;
}

export interface Example {
  raw: string;
  human: string;
}

export interface RoomExamples {
  corrections: Example[];
  kept: Example[];
}

export interface SelectOptions {
  windowDays?: number;
  minEdited?: number;
  maxCorrections?: number;
  perLabel?: number;
  maxKept?: number;
  maxRawLen?: number;
  now?: number;
}

// docs/15 §8 (2026-11-22 決めた数)
export const DEFAULTS = { windowDays: 42, minEdited: 20, maxCorrections: 40, perLabel: 6, maxKept: 15, maxRawLen: 120, maxChars: 8000 };

const HEADER =
  '## このルームで人が直した例 (最近の手直しから。左が文字起こし、右が人が確かめた正しい文)\n' +
  '似た聞き違いがあれば、同じように直してください。呼び出し先がそのまま正しかった例も含めています。例に無い語を無理に当てはめないでください。\n';

export interface DiffOp {
  op: 'equal' | 'replace' | 'insert' | 'delete';
  i1: number;
  i2: number;
  j1: number;
  j2: number;
}

/** 文字単位の差分 (最長共通部分列)。続いた不一致は 1 つの replace / insert / delete にまとめる。 */
export function diffOps(a: string, b: string): DiffOp[] {
  const A = Array.from(a);
  const B = Array.from(b);
  const n = A.length;
  const m = B.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  const push = (op: DiffOp['op'], i1: number, i2: number, j1: number, j2: number) => {
    const last = ops[ops.length - 1];
    const same = last && (last.op === 'equal') === (op === 'equal');
    if (same) {
      last.i2 = i2;
      last.j2 = j2;
      if (op !== 'equal') last.op = last.i1 === last.i2 ? 'insert' : last.j1 === last.j2 ? 'delete' : 'replace';
    } else {
      ops.push({ op, i1, i2, j1, j2 });
    }
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      push('equal', i, i + 1, j, j + 1);
      i++;
      j++;
    } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
      push('insert', i, i, j, j + 1);
      j++;
    } else {
      push('delete', i, i + 1, j, j);
      i++;
    }
  }
  // 位置は文字 (コードポイント) 単位。呼び出し側は Array.from で切る
  return ops.length ? ops : [{ op: 'equal', i1: 0, i2: 0, j1: 0, j2: 0 }];
}

const count = (s: string, t: string) => (t ? s.split(t).length - 1 : 0);
const slice = (s: string, a: number, b: number) => Array.from(s).slice(a, b).join('');

/**
 * 人が AI の版を辞書の語に直した所 (最初の 1 か所)。
 * @param terms 辞書の語 (2 字以上を使う)。長い語を先に見る
 * @returns {wrong: 置き換えられた AI の版の文字列, label: 増えた辞書の語} / 無ければ null
 */
export function correctionPattern(ai: string, human: string, terms: string[]): { wrong: string; label: string } | null {
  const labels = [...new Set(terms.filter((t) => t && Array.from(t).length >= 2))].sort((x, y) => Array.from(y).length - Array.from(x).length);
  for (const o of diffOps(ai, human)) {
    if (o.op !== 'replace' && o.op !== 'insert') continue;
    const around = slice(human, Math.max(0, o.j1 - 4), o.j2 + 4);
    const wrong = slice(ai, o.i1, o.i2).trim();
    const label = labels.find((t) => around.includes(t) && count(ai, t) < count(human, t));
    const len = Array.from(wrong).length;
    if (label && len > 0 && len <= 12) return { wrong, label };
  }
  return null;
}

const HEAD = /^\s*([^、。？?！!\s]{1,10})[、。？?]/;
const head = (s: string) => (s.match(HEAD) || [])[1] ?? null;

/**
 * 例を選ぶ。人が直した便が minEdited 未満の部屋は null (= 載せない、今と同じ動き)。
 * 直した例: 崩れ方 (wrong→label) の多い順、同じ崩れ方は 1 例、1 語あたり perLabel まで
 * そのまま正しかった例: 人が直した便のうち、文頭の呼びかけを人が変えなかった呼び出しの便。呼びかけの多い順に 1 例ずつ
 *   ★ 「取れ」で呼び出しを見分けるのはトランシーバーの話し方に寄っている。ボイスメッセージに広げる前に測り直す (docs/15 §3.2)
 */
export function selectExamples(rows: ExampleSourceRow[], terms: string[], opts: SelectOptions = {}): RoomExamples | null {
  const o = { ...DEFAULTS, ...opts };
  const since = (o.now ?? Date.now()) - o.windowDays * 86400e3;
  const edited = rows
    .filter((r) => r.human && r.raw && r.ai && Date.parse(r.created_at) >= since)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  if (edited.length < o.minEdited) return null;

  const pats = edited.map((r) => ({ r, p: correctionPattern(r.ai, r.human!, terms) })).filter((x) => x.p);
  const key = (p: { wrong: string; label: string }) => `${p.wrong}\u0000${p.label}`;
  const freq = new Map<string, number>();
  const labFreq = new Map<string, number>();
  for (const { p } of pats) {
    freq.set(key(p!), (freq.get(key(p!)) || 0) + 1);
    labFreq.set(p!.label, (labFreq.get(p!.label) || 0) + 1);
  }
  const cand = pats
    .map((x, idx) => ({ ...x, idx }))
    .filter(({ r }) => Array.from(r.raw).length <= o.maxRawLen)
    .sort((a, b) => (freq.get(key(b.p!))! - freq.get(key(a.p!))!) || (labFreq.get(b.p!.label)! - labFreq.get(a.p!.label)!) || a.idx - b.idx);
  const corrections: Example[] = [];
  const seen = new Set<string>();
  const perLab = new Map<string, number>();
  for (const { r, p } of cand) {
    if (corrections.length >= o.maxCorrections) break;
    if (seen.has(key(p!)) || (perLab.get(p!.label) || 0) >= o.perLabel) continue;
    seen.add(key(p!));
    perLab.set(p!.label, (perLab.get(p!.label) || 0) + 1);
    corrections.push({ raw: r.raw, human: r.human! });
  }

  const used = new Set(corrections.map((e) => e.raw));
  const byHead = new Map<string, Example[]>();
  for (const r of edited) {
    const h = head(r.raw);
    if (!h || head(r.human!) !== h || Array.from(r.raw).length > o.maxRawLen || used.has(r.raw) || !slice(r.human!, 0, 40).includes('取れ')) continue;
    if (!byHead.has(h)) byHead.set(h, []);
    byHead.get(h)!.push({ raw: r.raw, human: r.human! });
  }
  const kept = [...byHead.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, o.maxKept)
    .map(([, v]) => v[0]);
  return { corrections, kept };
}

/** 指示の先頭に置く文。上限を超えたら後ろの例から落とす (そのまま正しかった例 → 直した例の順)。例が無ければ空文字 */
export function examplesBlock(ex: RoomExamples, maxChars: number = DEFAULTS.maxChars): string {
  const corrections = [...ex.corrections];
  const kept = [...ex.kept];
  const render = () => {
    const all = [...corrections, ...kept];
    return all.length ? HEADER + all.map((e) => `- ${e.raw}\n  → ${e.human}`).join('\n') + '\n\n' : '';
  };
  let b = render();
  while (b.length > maxChars && (kept.length || corrections.length)) {
    if (kept.length) kept.pop();
    else corrections.pop();
    b = render();
  }
  return b;
}

// ---------------------------------------------------------------- DB (薄い部分)

const cache = new Map<string, { block: string; at: number }>();
const TTL_MS = 24 * 3600e3; // 1 日 1 回選び直す (docs/15 §3.3)

/** テスト用 */
export function clearRoomExamplesCache(): void {
  cache.clear();
}

/**
 * 部屋の例の文を返す (キャッシュつき、1 日 1 回選び直す)。★ 失敗しても投げない ('' を返す = 今と同じ動き)。
 * @param terms 辞書の語 (loadGuideline().vocabulary の term)
 */
export async function loadRoomExamples(roomId: string, terms: string[], now: number = Date.now()): Promise<string> {
  const hit = cache.get(roomId);
  if (hit && now - hit.at < TTL_MS) return hit.block;
  try {
    // 版 1 (AI) と、人 (bot でない利用者) の最新版。bot・アシスタントの編集は例にしない (docs/15 §3.1)
    const { rows } = await pool.query<ExampleSourceRow>(
      `SELECT m.id, m.created_at,
              v1.raw_text AS raw, v1.formatted_text AS ai,
              (SELECT v.formatted_text FROM voice_transcriptions v JOIN users u ON u.id = v.edited_by
                WHERE v.message_id = m.id AND COALESCE(u.is_bot, false) = false
                ORDER BY v.version DESC LIMIT 1) AS human
         FROM messages m
         JOIN voice_transcriptions v1 ON v1.message_id = m.id AND v1.version = 1
        WHERE m.room_id = $1 AND m.is_deleted = false
          AND m.created_at > now() - ($2 || ' days')::interval`,
      [roomId, String(DEFAULTS.windowDays)],
    );
    const ex = selectExamples(
      rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })),
      terms,
      { now },
    );
    const block = ex ? examplesBlock(ex) : '';
    cache.set(roomId, { block, at: now });
    logger.info(`[roomExamples] room ${roomId}: ${ex ? `${ex.corrections.length} corrections + ${ex.kept.length} kept, ${block.length} chars` : 'not enough human edits, none'}`);
    return block;
  } catch (err) {
    logger.warn(`[roomExamples] could not build examples for room ${roomId}, continuing without: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/**
 * #327 自己成長ループ — 人間の文字起こし編集から garble→term を学び、辞書テーブルを育てる。
 *
 *   AI版 vs 人間版 → extractAliasPairs(決定論) → 安価ゲート(短別名/音韻) → upsertAlias('pending', count++)
 *   → corpus-precision 昇格ゲート → 'active' に昇格 → refreshVocabFromTable
 *
 * 安価ゲート(短別名/音韻)は書込前。corpus-precision(修正回数/出現)は単一編集で判定不能なので
 * 昇格ゲートとして扱う: 'pending' で累積し、P>=閾値で 'active' に昇格(補正段は active のみ引く)。
 * 音韻ゲートは garble/term 双方の読みを要る。garble は STT の漢字誤変換が多く読みが無いので、
 * reading サービス(pykakasi)で読みを当てる(kata2hira はカタカナしか変換できず漢字 garble を全棄却していた)。
 * STT エンジン非依存(Whisper/Qwen どちらの崩れも吸収)。organon 非依存(Tealus 単体で育つ)。
 */
import { pool } from '../db/pool.mts';
import * as repo from './dictionaryRepo.mts';
import * as readingService from './reading.mts';
import { extractAliasPairs, toMoras, moraDistance, corpusPrecision } from './aliasMiner.mts';
import { refreshVocabFromTable } from './transcriptionConfig.mts';

const { kata2hira } = readingService;
// ① で garble の読みが取れる前提で、短別名判定を「文字数」でなく「読みのモーラ数」に。
// 小坂(こさか=3モーラ) のような2字の漢字姓を通しつつ、たま/こさ(2モーラ=音が短く曖昧)は棄却する。
const MIN_MORAS = 3;   // 読みが3モーラ未満は過補正リスクで除外
const MORA_MAX = 0.5;  // 読みのモーラ距離。本物の崩れは音を保つ
const P_MIN = 0.5;     // corpus-precision 昇格閾値

/** occurrence カウントの集計行 */
interface OccurrenceRow {
  n: number;
}

/** garble がコーパス(文字起こし)全体に現れる件数（corpus-precision の分母） */
export async function occurrenceFromDb(garble: string): Promise<number> {
  const { rows } = await pool.query<OccurrenceRow>(
    `SELECT COUNT(DISTINCT message_id)::int AS n
       FROM voice_transcriptions
      WHERE raw_text LIKE $1 OR formatted_text LIKE $1`,
    [`%${garble}%`],
  );
  return rows[0] ? rows[0].n : 0;
}

/**
 * ゲート棄却の内訳 (#371)。
 * ★ 「何を直せば拾えるようになるか」は理由が分かれていないと判断できない。
 *   moras    … 読みが MIN_MORAS 未満 (短すぎて曖昧)
 *   phonetic … 読みのモーラ距離が MORA_MAX 超 (音が保たれていない)
 *   noTerm   … 音韻は通ったが alias を付ける先の term が無い (新 entity は Phase2 未実装)
 */
export interface GateRejectionBreakdown {
  moras: number;
  phonetic: number;
  noTerm: number;
}

/**
 * ★ 棄却された 1 ペアの中身 (#371)。
 * 件数だけでは「読みを取り違えて落ちたのか、本当に音が遠いのか」が区別できない。
 * 実例: `終礼` を pykakasi が「おわりれい」と訓読みし、`修繕`(しゅうぜん) との距離が
 * 1.00 になって棄却された。正しい「しゅうれい」なら距離 0.50 = ちょうど通過だった。
 */
export interface GateRejection {
  garble: string;
  term: string;
  reason: keyof GateRejectionBreakdown;
  /** 判定に実際に使った読み (pykakasi の誤りはここに出る) */
  garbleReading: string;
  termReading: string;
  /** garble の読みのモーラ数 (moras 棄却の判断材料) */
  moras: number;
  /** 読みのモーラ距離 (phonetic 棄却の判断材料)。moras 棄却時は未計算で -1 */
  distance: number;
}

/**
 * ★ 受理された 1 ペアの中身 (#371)。
 * 棄却側だけを中身つきで出していたので、「絞りを足したら何を失うか」が測れなかった。
 * 実測 (8/10-8/15): 棄却 18 件のうち 8 件が 2 モーラの term「ガマ」への誤ペアだが、
 * 「term にもモーラ下限を入れる」で正しい学習を何件落とすかは、受理側が無いと片側しか見えない。
 * → そのため term 側の読み・モーラ数も残す (garble 側だけでは絞りの費用が出せない)。
 */
export interface AliasAcceptance {
  garble: string;
  term: string;
  garbleReading: string;
  termReading: string;
  /** garble の読みのモーラ数 */
  moras: number;
  /** ★ term の読みのモーラ数。短い term を切る判断はこれで測る */
  termMoras: number;
  /** 読みのモーラ距離 (通過しているので必ず MORA_MAX 以下) */
  distance: number;
  /** この編集での帰結。active = 昇格ゲートも通った */
  status: 'active' | 'pending';
}

/** learnFromEdit の集計結果 */
export interface LearnFromEditResult {
  learned: number;
  promoted: number;
  pending: number;
  extracted: number;
  gateRejected: number;
  /** ★ gateRejected の内訳。3 つの合計は必ず gateRejected と一致する */
  gateRejectedBy: GateRejectionBreakdown;
  /** ★ 棄却されたペアの中身。length は必ず gateRejected と一致する */
  gateRejections: GateRejection[];
  /** ★ 受理されたペアの中身。length は必ず learned と一致する */
  accepted: AliasAcceptance[];
}

export interface LearnFromEditOptions {
  /** 出現数(既定=DB)。テスト差し替え用 */
  getOccurrence?: (g: string) => Promise<number>;
  /** garble 読み供給(既定=reading サービス/pykakasi) */
  getReadings?: (t: string[]) => Promise<Map<string, string>>;
}

/**
 * 1 編集ぶんの AI版→人間版 から辞書を育てる。
 * @param edit
 * @param opts
 */
export async function learnFromEdit(
  { priorFormatted, newFormatted }: { priorFormatted: string; newFormatted: string },
  opts: LearnFromEditOptions = {},
): Promise<LearnFromEditResult> {
  const getOccurrence = opts.getOccurrence || occurrenceFromDb;
  const prior = String(priorFormatted || '');
  const next = String(newFormatted || '');
  const empty: LearnFromEditResult = {
    learned: 0, promoted: 0, pending: 0, extracted: 0, gateRejected: 0,
    gateRejectedBy: { moras: 0, phonetic: 0, noTerm: 0 }, gateRejections: [], accepted: [],
  };
  if (!prior || !next || prior === next) return empty;

  const vocab = await repo.listActiveVocabulary();
  if (!vocab.length) return empty;
  const readingByTerm = new Map(vocab.map((v): [string, string] => [v.term, v.reading || '']));
  const termIdByTerm = new Map(vocab.map((v) => [v.term, v.id] as const));

  const pairs = extractAliasPairs(prior, next, vocab.map((v) => v.term));
  if (!pairs.length) return empty;
  // 1 編集内は (garble,term) を一意化（同一崩れが複数出ても 1 回の証拠）
  const seen = new Set<string>();
  const uniquePairs: typeof pairs = [];
  for (const p of pairs) {
    const key = `${p.from} ${p.to}`;
    if (!seen.has(key)) { seen.add(key); uniquePairs.push(p); }
  }

  // garble の読みを pykakasi で当てる（漢字 garble を音韻ゲートで採点可能に。term は table 読み）。
  const getReadings = opts.getReadings || readingService.getReadings;
  const garbleReadings = await getReadings(uniquePairs.map((p) => p.from));
  const getReading = (s: string): string => readingByTerm.get(s) || garbleReadings.get(s) || kata2hira(s);

  let promoted = 0; let pending = 0; let gateRejected = 0;
  const gateRejectedBy: GateRejectionBreakdown = { moras: 0, phonetic: 0, noTerm: 0 };
  const gateRejections: GateRejection[] = [];
  const accepted: AliasAcceptance[] = [];
  /** 棄却を 1 件記録する。件数と中身を必ず同時に進めるための唯一の入口。 */
  const reject = (reason: keyof GateRejectionBreakdown, garble: string, term: string, moras: number, distance: number) => {
    gateRejected += 1;
    gateRejectedBy[reason] += 1;
    gateRejections.push({ garble, term, reason, garbleReading: getReading(garble), termReading: getReading(term), moras, distance });
  };

  for (const { from: garble, to: term } of uniquePairs) {
    // --- 安価ゲート（書込前）--- ★ 理由別に数え、中身も残す (#371)
    const moras = toMoras(getReading(garble)).length;
    if (moras < MIN_MORAS) { reject('moras', garble, term, moras, -1); continue; }
    const distance = moraDistance(getReading(garble), getReading(term));
    if (distance > MORA_MAX) { reject('phonetic', garble, term, moras, distance); continue; }
    const termId = termIdByTerm.get(term);
    // ★ 音韻は通ったのに term が無くて捨てている分。ここが Phase2 (term の pending 起票) の対象。
    if (!termId) { reject('noTerm', garble, term, moras, distance); continue; }

    // pending で累積（既存 active/pending は count 加算、rejected は no-op）
    const { row, applied } = await repo.upsertAlias({ termId, alias: garble, source: 'auto', count: 1, status: 'pending' });
    if (!applied || !row) continue;

    // --- corpus-precision 昇格ゲート ---
    const occ = await getOccurrence(garble);
    const active = corpusPrecision(row.count, occ) >= P_MIN;
    let status: AliasAcceptance['status'];
    if (active && row.status !== 'active') { await repo.setAliasStatus(row.id, 'active'); promoted += 1; status = 'active'; }
    else if (row.status === 'active') { promoted += 1; status = 'active'; }
    else { pending += 1; status = 'pending'; }
    // ★ 件数と中身を必ず同時に進める (棄却側の reject() と同じ約束)
    accepted.push({
      garble, term, garbleReading: getReading(garble), termReading: getReading(term),
      moras, termMoras: toMoras(getReading(term)).length, distance, status,
    });
  }

  const learned = promoted + pending;
  if (learned) {
    // 育った辞書を実行時オーバーレイに反映（active のみが補正段に効く）
    await refreshVocabFromTable();
  }
  return { learned, promoted, pending, extracted: uniquePairs.length, gateRejected, gateRejectedBy, gateRejections, accepted };
}

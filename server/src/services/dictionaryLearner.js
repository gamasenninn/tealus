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
const pool = require('../db/pool');
const repo = require('./dictionaryRepo');
const readingService = require('./reading');
const { extractAliasPairs, toMoras, moraDistance, corpusPrecision } = require('./aliasMiner');

const { kata2hira } = readingService;
// ① で garble の読みが取れる前提で、短別名判定を「文字数」でなく「読みのモーラ数」に。
// 小坂(こさか=3モーラ) のような2字の漢字姓を通しつつ、たま/こさ(2モーラ=音が短く曖昧)は棄却する。
const MIN_MORAS = 3;   // 読みが3モーラ未満は過補正リスクで除外
const MORA_MAX = 0.5;  // 読みのモーラ距離。本物の崩れは音を保つ
const P_MIN = 0.5;     // corpus-precision 昇格閾値

/** garble がコーパス(文字起こし)全体に現れる件数（corpus-precision の分母） */
async function occurrenceFromDb(garble) {
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT message_id)::int AS n
       FROM voice_transcriptions
      WHERE raw_text LIKE $1 OR formatted_text LIKE $1`,
    [`%${garble}%`],
  );
  return rows[0] ? rows[0].n : 0;
}

/**
 * 1 編集ぶんの AI版→人間版 から辞書を育てる。
 * @param {{priorFormatted:string, newFormatted:string}} edit
 * @param {object} [opts]
 * @param {(g:string)=>Promise<number>} [opts.getOccurrence] - 出現数(既定=DB)。テスト差し替え用
 * @param {(t:string[])=>Promise<Map>} [opts.getReadings] - garble 読み供給(既定=reading サービス/pykakasi)
 * @returns {Promise<{learned:number, promoted:number, pending:number, extracted:number, gateRejected:number}>}
 */
async function learnFromEdit({ priorFormatted, newFormatted }, opts = {}) {
  const getOccurrence = opts.getOccurrence || occurrenceFromDb;
  const prior = String(priorFormatted || '');
  const next = String(newFormatted || '');
  const empty = { learned: 0, promoted: 0, pending: 0, extracted: 0, gateRejected: 0 };
  if (!prior || !next || prior === next) return empty;

  const vocab = await repo.listActiveVocabulary();
  if (!vocab.length) return empty;
  const readingByTerm = new Map(vocab.map((v) => [v.term, v.reading || '']));
  const termIdByTerm = new Map(vocab.map((v) => [v.term, v.id]));

  const pairs = extractAliasPairs(prior, next, vocab.map((v) => v.term));
  if (!pairs.length) return empty;
  // 1 編集内は (garble,term) を一意化（同一崩れが複数出ても 1 回の証拠）
  const seen = new Set();
  const uniquePairs = [];
  for (const p of pairs) {
    const key = `${p.from} ${p.to}`;
    if (!seen.has(key)) { seen.add(key); uniquePairs.push(p); }
  }

  // garble の読みを pykakasi で当てる（漢字 garble を音韻ゲートで採点可能に。term は table 読み）。
  const getReadings = opts.getReadings || readingService.getReadings;
  const garbleReadings = await getReadings(uniquePairs.map((p) => p.from));
  const getReading = (s) => readingByTerm.get(s) || garbleReadings.get(s) || kata2hira(s);

  let promoted = 0; let pending = 0; let gateRejected = 0;
  for (const { from: garble, to: term } of uniquePairs) {
    // --- 安価ゲート（書込前）---
    if (toMoras(getReading(garble)).length < MIN_MORAS) { gateRejected += 1; continue; }      // 短別名(モーラ数)
    if (moraDistance(getReading(garble), getReading(term)) > MORA_MAX) { gateRejected += 1; continue; } // 音韻

    const termId = termIdByTerm.get(term);
    if (!termId) { gateRejected += 1; continue; } // MVP: 既存 term への alias のみ（新 entity は Phase2）

    // pending で累積（既存 active/pending は count 加算、rejected は no-op）
    const { row, applied } = await repo.upsertAlias({ termId, alias: garble, source: 'auto', count: 1, status: 'pending' });
    if (!applied || !row) continue;

    // --- corpus-precision 昇格ゲート ---
    const occ = await getOccurrence(garble);
    const active = corpusPrecision(row.count, occ) >= P_MIN;
    if (active && row.status !== 'active') { await repo.setAliasStatus(row.id, 'active'); promoted += 1; }
    else if (row.status === 'active') { promoted += 1; }
    else { pending += 1; }
  }

  const learned = promoted + pending;
  if (learned) {
    // 育った辞書を実行時オーバーレイに反映（active のみが補正段に効く）
    await require('./transcriptionConfig').refreshVocabFromTable();
  }
  return { learned, promoted, pending, extracted: uniquePairs.length, gateRejected };
}

module.exports = { learnFromEdit, occurrenceFromDb };

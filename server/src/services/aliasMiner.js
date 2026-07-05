/**
 * Transcription alias miner — voice_transcriptions 編集履歴から alias 候補を抽出する
 *
 * 入力: voice_transcriptions の rows (message_id 単位で AI 版と人間編集版を含む)
 * 出力: alias 候補 ({from: 誤転写, to: 正解}) の集約
 *
 * GPT-4o-mini を呼び出して整形差を除外しつつ固有名詞ペアのみ抽出する。
 */

const SYSTEM_PROMPT = `あなたは音声文字起こしの編集ペアから、組織固有語の transcription alias を抽出するアシスタントです。
入力として AI が生成した formatted_text と、ユーザーが訂正した formatted_text を受け取り、
ユーザーが訂正した固有名詞・専門用語のペアを JSON 配列で返してください。

ルール:
- 句読点の差 ("?" → "？") は無視
- フィラー削除 (「えーと」「あのー」) や整形差は無視
- 固有名詞 (人名・地名・商品名・部署名) と業務固有用語のみ対象
- 一般的な漢字変換 (例: 「もっとも」→「最も」) は無視
- category は person / place / product / code / role / term から推測
- confidence は high (文脈的に確実) / medium / low (推測) から判定
- 該当が無ければ空配列 []

出力形式 (JSON のみ、説明文不要):
[{"from":"誤転写","to":"正解","category":"person","confidence":"high"}]`;

function buildPairsFromRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.message_id)) grouped.set(row.message_id, []);
    grouped.get(row.message_id).push(row);
  }

  const pairs = [];
  for (const [messageId, versions] of grouped.entries()) {
    const aiVersions = versions.filter(v => v.edited_by === null || v.edited_by === undefined);
    const userVersions = versions.filter(v => v.edited_by !== null && v.edited_by !== undefined);
    if (aiVersions.length === 0 || userVersions.length === 0) continue;

    const aiVersion = aiVersions.reduce((max, v) => (v.version > max.version ? v : max));
    const userVersion = userVersions.reduce((max, v) => (v.version > max.version ? v : max));

    if (!aiVersion.formatted_text || !userVersion.formatted_text) continue;
    if (aiVersion.formatted_text === userVersion.formatted_text) continue;

    pairs.push({
      messageId,
      aiText: aiVersion.formatted_text,
      userText: userVersion.formatted_text,
    });
  }
  return pairs;
}

async function extractAliases(pair, openai, options = {}) {
  const model = options.model || 'gpt-4o-mini';
  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `AI: ${pair.aiText}\nUser: ${pair.userText}` },
      ],
      temperature: 0.1,
      max_completion_tokens: 500,
    });
    const text = response.choices[0].message.content.trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      a => a && typeof a.from === 'string' && typeof a.to === 'string'
        && a.from.length > 0 && a.to.length > 0 && a.from !== a.to
    );
  } catch (err) {
    return [];
  }
}

/**
 * 集計モード:
 *   'pair'    : (from, to) pair の出現回数で threshold 判定 (default、現状動作)
 *   'by-term' : to (term) の合計出現回数で threshold 判定。
 *               頻出 term の長尾誤認パターン (個別 pair 1 件) を救う (#208)
 *
 * 互換性: 第 2 引数が number の場合 (legacy) は threshold として扱う
 */
function aggregateAliases(allAliases, options = {}) {
  if (typeof options === 'number') {
    options = { threshold: options };
  }
  const {
    mode = 'pair',
    threshold = 2,
    requireHighConfidence = false,
  } = options;

  // Step 1: Build pair-level map
  const pairMap = new Map();
  for (const alias of allAliases) {
    const key = `${alias.from}|${alias.to}`;
    if (!pairMap.has(key)) {
      pairMap.set(key, {
        from: alias.from,
        to: alias.to,
        count: 0,
        confidences: { high: 0, medium: 0, low: 0 },
        categories: new Map(),
      });
    }
    const entry = pairMap.get(key);
    entry.count++;
    const conf = alias.confidence || 'medium';
    if (entry.confidences[conf] !== undefined) entry.confidences[conf]++;
    const cat = alias.category || 'term';
    entry.categories.set(cat, (entry.categories.get(cat) || 0) + 1);
  }

  // Step 2: Compute term-level totals (used in by-term mode)
  const termTotals = new Map();
  for (const entry of pairMap.values()) {
    if (!termTotals.has(entry.to)) {
      termTotals.set(entry.to, { totalCount: 0, hasHigh: false });
    }
    const tt = termTotals.get(entry.to);
    tt.totalCount += entry.count;
    if (entry.confidences.high > 0) tt.hasHigh = true;
  }

  // Step 3: Apply threshold and build result
  const result = [];
  for (const entry of pairMap.values()) {
    let pass;
    if (mode === 'by-term') {
      const tt = termTotals.get(entry.to);
      pass = tt.totalCount >= threshold;
      if (requireHighConfidence) pass = pass && tt.hasHigh;
    } else {
      pass = entry.count >= threshold;
    }
    if (!pass) continue;

    let bestCat = 'term';
    let bestCount = 0;
    for (const [cat, n] of entry.categories) {
      if (n > bestCount) {
        bestCat = cat;
        bestCount = n;
      }
    }
    result.push({
      from: entry.from,
      to: entry.to,
      category: bestCat,
      count: entry.count,
      confidences: entry.confidences,
    });
  }
  result.sort((a, b) => b.count - a.count);
  return result;
}

function buildMergeCandidates(aggregated, existingVocabulary = []) {
  const existingByTerm = new Map();
  for (const v of existingVocabulary) {
    if (v && v.term) {
      existingByTerm.set(v.term, {
        term: v.term,
        category: v.category,
        aliases: Array.isArray(v.aliases) ? v.aliases : [],
      });
    }
  }

  const byTerm = new Map();
  for (const a of aggregated) {
    if (!byTerm.has(a.to)) byTerm.set(a.to, []);
    byTerm.get(a.to).push(a);
  }

  const newTerms = [];
  const aliasAdditions = [];
  for (const [term, aliases] of byTerm) {
    const existing = existingByTerm.get(term);
    if (existing) {
      const existingAliases = new Set(existing.aliases);
      const newAliases = aliases.filter(a => !existingAliases.has(a.from));
      if (newAliases.length > 0) {
        aliasAdditions.push({
          term,
          existingTerm: true,
          existingCategory: existing.category,
          new_aliases: newAliases.map(a => a.from),
          counts: Object.fromEntries(newAliases.map(a => [a.from, a.count])),
        });
      }
    } else {
      newTerms.push({
        term,
        category: aliases[0].category,
        aliases: aliases.map(a => a.from),
        counts: Object.fromEntries(aliases.map(a => [a.from, a.count])),
      });
    }
  }

  return { newTerms, aliasAdditions };
}

// --- #327 決定論 term アンカー整列 抽出 (LLM不要) --------------------------
// 「どこが変わったか」を汎用に探すのでなく、「この既知 term は元テキストのどこから来たか」を
// 逆に引く。人間版 (new) 中の既知 term を見つけ、LCS 整列で AI版 (old) 側の対応スパンを読む
// = それが崩れ (garble)。char-LCS の block 方式が「崩れと正解が文字を共有すると差分が収縮して
// term を含まなくなる」盲点 (ママ→ガマ 等) を、term に錨を打つことで構造的に回避する。
// 「○○さん」の "さん" が右アンカーとなり「その手前は名前」という意味的足場を与える。
// extractAliases(LLM) の代替 = 無料・決定論・organon非依存 (Tealus単体で回る)。

// LCS の一致ペア列 [[oldIdx, newIdx], ...] (両方増加) = 変わらなかった錨。長すぎる入力は null。
function lcsAnchors(a, b, maxLen = 400) {
  const n = a.length, m = b.length;
  if (n > maxLen || m > maxLen) return null;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const anchors = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { anchors.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; }
    else { j++; }
  }
  return anchors;
}

// text 中の既知 term を最長一致・非重複で検出 → [{i, j, term}] (i..j が term のスパン)。
function findTermSpans(text, terms) {
  const sorted = [...new Set(terms.filter(Boolean))].sort((x, y) => y.length - x.length);
  const claimed = new Array(text.length).fill(false);
  const spans = [];
  for (const term of sorted) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(term, from);
      if (idx < 0) break;
      let free = true;
      for (let k = idx; k < idx + term.length; k++) if (claimed[k]) { free = false; break; }
      if (free) {
        for (let k = idx; k < idx + term.length; k++) claimed[k] = true;
        spans.push({ i: idx, j: idx + term.length, term });
      }
      from = idx + 1;
    }
  }
  return spans.sort((x, y) => x.i - y.i);
}

/**
 * AI版 vs 人間版から garble→既知term の置換ペアを決定論抽出する (term アンカー整列)。
 * @param {string} aiText   - AI整形版 (old)
 * @param {string} userText - 人間編集版 (new)
 * @param {string[]} terms  - 既知の固有名詞term (new に現れたものを逆引き)
 * @param {object} [opts]
 * @param {number} [opts.maxRewriteFraction=0.5] - new の未一致率がこれ超なら全文書換とみなし棄却
 * @param {number} [opts.maxGarbleLen=12] - 崩れの最大長。超は文章とみなし無視
 * @returns {Array<{from:string,to:string}>}
 */
function extractAliasPairs(aiText, userText, terms = [], opts = {}) {
  const { maxRewriteFraction = 0.5, maxGarbleLen = 12 } = opts;
  const a = String(aiText || ''), b = String(userText || '');
  if (!a || !b || a === b) return [];
  const anchors = lcsAnchors(a, b);
  if (anchors === null) return [];
  // 全文書換ガード: 人間版のうち元テキストと一致しない割合が高すぎたら錨が信用できない
  if ((b.length - anchors.length) / Math.max(b.length, 1) > maxRewriteFraction) return [];

  const out = [];
  const seen = new Set();
  for (const { i, j, term } of findTermSpans(b, terms)) {
    // term スパン [i,j) の左右の錨 → old 側の対応スパン = 崩れ。
    // スパン内側の偶然の一致 (共有文字) は n<i / n>=j の条件で自動的に無視される。
    let oL = -1;             // 左錨の oldIdx (無ければ -1 = 先頭)
    let oR = a.length;       // 右錨の oldIdx (無ければ末尾)
    for (const [o, n] of anchors) { if (n < i) oL = o; else break; }
    for (const [o, n] of anchors) { if (n >= j) { oR = o; break; } }
    const from = a.slice(oL + 1, oR).trim();
    if (!from || from === term) continue;           // 純挿入(前置) / 変化なし
    if (from.length > maxGarbleLen) continue;        // 文章 → 無視
    if (from.includes(term) || term.includes(from)) continue;
    const key = `${from} ${term}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to: term });
  }
  return out;
}

// --- #327 Phase1 安全ゲート ------------------------------------------------
// 集約済み garble→term に「音韻近接」「コーパス精度」の2ゲートを掛け、変換して他を
// 壊さない候補だけを 自動追加 / 人間確認 に振り分ける。読み・出現数は呼び出し側から
// 注入する (pykakasi/DB 非依存 = 純関数・テスト可能)。抽出→集約は既存関数を再利用。

const HONORIFIC = /(さん|さま|様|くん|君|ちゃん)$/;
function stripHonorific(s) { return String(s || '').replace(HONORIFIC, ''); }

const SMALL_KANA = new Set('ぁぃぅぇぉゃゅょゎっー');
function toHiragana(s) {
  return [...String(s || '')].map((ch) => {
    const o = ch.codePointAt(0);
    return (o >= 0x30A1 && o <= 0x30F6) ? String.fromCodePoint(o - 0x60) : ch;
  }).join('');
}
function toMoras(s) {
  const out = [];
  for (const c of toHiragana(s)) {
    if (SMALL_KANA.has(c) && out.length) out[out.length - 1] += c;
    else out.push(c);
  }
  return out;
}

/**
 * 正規化モーラ編集距離 [0,1]。garble読み ≈ term読み の近さ (本物の崩れは音を保つ)。
 * カタカナ/ひらがな どちらの読みでも内部で正規化して比較する。空入力は 1 (無効)。
 */
function moraDistance(a, b) {
  const x = toMoras(a), y = toMoras(b);
  const n = x.length, m = y.length;
  if (!n || !m) return 1;
  const dp = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const cur = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return dp[m] / Math.max(n, m);
}

/**
 * コーパス精度 P = 修正回数 / garble総出現。低P = その garble は他用途でも使われる
 * = alias化して変換すると他を壊す (どうも/たま 等の常用語ガード)。出現数<回数は 1 に丸め。
 */
function corpusPrecision(count, occurrence) {
  return count / Math.max(occurrence || 0, count);
}

/**
 * 集約済み alias 候補に 2 ゲートを適用し 自動追加 / 人間確認 / 棄却 に振り分ける。
 * @param {Array} aggregated - aggregateAliases の戻り ({from, to, count, ...})
 * @param {object} opts
 * @param {(text:string)=>string} opts.getReading    - ひらがな読み (kanji含む、注入)
 * @param {(garble:string)=>number} opts.getOccurrence - コーパス総出現数 (注入)
 * @param {number} [opts.minGarbleLen=3] - garble(honorific除去後)の最小長。≤2 は棄却 (Exp7過補正)
 * @param {number} [opts.moraMax=0.5]    - 音韻近接の許容モーラ距離
 * @param {number} [opts.pMin=0.5]       - コーパス精度の下限
 * @param {number} [opts.autoFreq=2]     - この回数以上で自動追加、未満は人間確認
 * @returns {{auto:Array, confirm:Array, rejected:Array}}
 */
function filterSafeAliases(aggregated, opts = {}) {
  const {
    getReading = () => '',
    getOccurrence = () => 1,
    minGarbleLen = 3,
    moraMax = 0.5,
    pMin = 0.5,
    autoFreq = 2,
  } = opts;
  const auto = [], confirm = [], rejected = [];
  for (const a of (aggregated || [])) {
    const garble = String(a.from || '');
    // ゲート1: 短別名 (≤2字の裸の姓/地名) → 過補正源なので棄却
    if (stripHonorific(garble).length < minGarbleLen) { rejected.push({ ...a, reason: 'short' }); continue; }
    // ゲート2: 音韻近接 (読みが遠い = 誤整列/話者前置アーティファクト)
    const dist = moraDistance(getReading(garble), getReading(a.to));
    if (dist > moraMax) { rejected.push({ ...a, reason: 'phonetic', dist }); continue; }
    // ゲート3: コーパス精度 (低P = 常用語 = 変換で他を壊す)
    const P = corpusPrecision(a.count, getOccurrence(garble));
    if (P < pMin) { rejected.push({ ...a, reason: 'common-word', P }); continue; }
    // 通過 → 頻度で 自動追加 / 人間確認 に分岐
    (a.count >= autoFreq ? auto : confirm).push({ ...a, dist, P });
  }
  return { auto, confirm, rejected };
}

module.exports = {
  buildPairsFromRows,
  extractAliases,
  aggregateAliases,
  buildMergeCandidates,
  SYSTEM_PROMPT,
  extractAliasPairs,
  moraDistance,
  corpusPrecision,
  filterSafeAliases,
};

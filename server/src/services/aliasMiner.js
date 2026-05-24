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

module.exports = {
  buildPairsFromRows,
  extractAliases,
  aggregateAliases,
  buildMergeCandidates,
  SYSTEM_PROMPT,
};

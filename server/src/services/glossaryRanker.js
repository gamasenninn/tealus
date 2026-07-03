/**
 * 履歴頻度ランカー (#326) — relevance順 hot-core glossary の構築。
 *
 * 2026-07-03 の実測則をコード化:
 *  - decode時 glossary が固有名詞回収の本体 (テキスト後補正では回収不能)。
 *  - curation の軸は category priority でなく「文脈/ルーム relevance」。効くのは
 *    「チャンネル(=1事業ドメイン)の常用コア語」で、メッセージ履歴の言及頻度で機械生成可能。
 *  - 順序が強い無料レバー: hot(高頻度)を glossary 先頭に置くと守られる。
 *  - 読みは hard entity 限定 (全語 blanket 読みは逆効果) → explicit reading フィールドのみ併記。
 *  - 短語 (「中」「44」等) の部分一致ノイズを抑えるため document frequency
 *    (言及メッセージ数) でカウントする (同一メッセージ内の複数出現は 1)。
 *  - 汎用役職 alias (社長/専務 等) は頻度マッチから除外。person entry が役職言及で
 *    過剰 hot 化する汚染を防ぐ (2026-07-03 実データで 桶田博信 が「社長」で過剰カウント)。
 *    名前付き役職 (桶田専務) は汎用ではないので残す。
 *
 * 純粋関数・DB 非依存 (直近メッセージの取得は呼び出し側の薄いアダプタが担う)。
 */

// 汎用役職・敬称 (これ単独では固有名詞でなく、person の alias でも頻度シグナルにしない)
const DEFAULT_ROLE_ALIASES = [
  '社長', '副社長', '会長', '専務', '常務', '部長', '次長', '課長', '係長', '主任',
  '店長', '所長', '専務取締役', 'ステージ社長',
];

/**
 * 1 メッセージテキストが vocab entry を言及しているか (term or 役職以外の alias を含むか)。
 * @param {object} [opts]
 * @param {Set<string>} [opts.roleSet] - 頻度マッチから除外する役職 alias
 */
function mentions(text, entry, opts = {}) {
  if (!text) return false;
  if (entry.term && text.includes(entry.term)) return true;
  const roleSet = opts.roleSet || new Set(DEFAULT_ROLE_ALIASES);
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  return aliases.some((a) => a && !roleSet.has(a) && text.includes(a));
}

/**
 * vocab を言及頻度 (document frequency) 降順にランクする。同数は元の vocab 順で安定。
 * @param {Array<{term, aliases?, reading?}>} vocabulary
 * @param {string[]} texts - 直近メッセージテキスト群
 * @param {object} [opts]
 * @param {string[]} [opts.roleAliases] - 頻度除外する役職 alias (default DEFAULT_ROLE_ALIASES)
 * @returns {Array<{term, reading?, count}>}
 */
function rankByFrequency(vocabulary, texts, opts = {}) {
  const list = Array.isArray(vocabulary) ? vocabulary : [];
  const msgs = Array.isArray(texts) ? texts : [];
  const roleSet = new Set(opts.roleAliases || DEFAULT_ROLE_ALIASES);
  return list
    .map((v, i) => {
      let count = 0;
      for (const t of msgs) if (mentions(t, v, { roleSet })) count += 1;
      return { v, i, count };
    })
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .map(({ v, count }) => ({ term: v.term, reading: v.reading, count }));
}

/**
 * relevance順 hot-core glossary 文字列を構築する。
 *  - 頻度降順 (hot 先頭)。
 *  - 既定は 0 言及を除外 (履歴に出た entity のみ = そのチャンネルの常用コア)。
 *  - explicit reading フィールドがある語のみ term（reading）で読み併記。
 * @param {Array} vocabulary
 * @param {string[]} texts
 * @param {object} [opts]
 * @param {number} [opts.limit=40]
 * @param {boolean} [opts.includeZero=false] - 0 言及も含める (履歴が乏しい時の fallback)
 * @returns {string}
 */
function buildHotGlossary(vocabulary, texts, opts = {}) {
  const { limit = 40, includeZero = false } = opts;
  const ranked = rankByFrequency(vocabulary, texts, opts)
    .filter((r) => r.term && (includeZero || r.count > 0))
    .slice(0, limit);
  return ranked.map((r) => (r.reading ? `${r.term}（${r.reading}）` : r.term)).join('、');
}

module.exports = { rankByFrequency, buildHotGlossary, mentions, DEFAULT_ROLE_ALIASES };

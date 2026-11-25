/**
 * bot の検索 (GET /api/bot/search、routes/bot.mts) の抜粋づくりと LIKE の逃がし。改善ループ 120 で bot.mts から出した (中身は同じ)。
 * ★ pool も logger も読まない純粋なファイルにしておく (bot.mts は読み込みの重い部品が多い)
 * テスト: __tests__/unit/searchSnippet.test.mts
 */

// LIKE wildcard escape: q に %, _, \ が含まれても安全に substring マッチ
export function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// match 前後 ±100 文字の snippet を **match** ハイライト付きで返す
export function buildSnippet(text: string | null, query: string | undefined, contextChars: number = 100): string {
  if (!text) return '(メディアのみ)';
  if (!query) return text.length > 200 ? text.slice(0, 200) + '...' : text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return text.length > 200 ? text.slice(0, 200) + '...' : text;
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);
  const before = text.slice(start, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length, end);
  let snippet = `${before}**${match}**${after}`;
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

import type { ReactNode } from 'react';

/**
 * 表示ハイライト専用のメンション検出 regex (#342 系リファクタで MessageBubble の 2 箇所インラインを集約)。
 *
 * ★ これは「表示で @名前 を色付けする」ためだけのもの。server 側の「メンション先頭限定判定」
 *   (isMentioned の `^@<name>`) とは別物 = dispatch 判定に流用しないこと。誰かが共用しようとすると
 *   先頭限定でない・表示用文字クラスの regex が dispatch に混ざり事故る。
 */
export const MENTION_DISPLAY_RE = /@([\w぀-ゟ゠-ヿ一-鿿ー・]+)/g;

interface HighlightOpts {
  markClassName?: string;
  keyPrefix?: string;
}

/**
 * text 中の keyword を `<mark>` で囲む。keyword は正規表現エスケープし、大小無視で分割。
 * markClassName 省略時は class 無しの素の `<mark>` (SearchPage 現行と同じ)。
 * text/keyword が空なら text をそのまま返す。
 */
export function renderKeywordHighlight(
  text: string | null | undefined,
  keyword: string | null | undefined,
  opts: HighlightOpts = {},
): ReactNode {
  if (!text || !keyword) return text;
  const { markClassName, keyPrefix = '' } = opts;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={`${keyPrefix}k${i}`} className={markClassName}>{part}</mark>
      : part,
  );
}

/**
 * text 中の @メンションを `<span class="mention-highlight">` で色付け。
 * searchKeyword 指定時は、メンション以外の部分にキーワードハイライトも重ねて適用する。
 * メンションが無ければ、searchKeyword があればキーワードのみ適用、無ければ text を素通し。
 * MessageBubble の processMentions (markdown 文字列ノード) と highlightText を 1 本に集約。
 */
export function renderMentions(
  text: string,
  opts: { searchKeyword?: string | null } & HighlightOpts = {},
): ReactNode {
  const { searchKeyword, markClassName, keyPrefix = '' } = opts;
  const parts = text.split(MENTION_DISPLAY_RE);
  if (parts.length <= 1) {
    return searchKeyword ? renderKeywordHighlight(text, searchKeyword, { markClassName, keyPrefix }) : text;
  }
  return parts.map((part, i) =>
    i % 2 === 1
      ? <span key={`${keyPrefix}m${i}`} className="mention-highlight">@{part}</span>
      : (searchKeyword
          ? renderKeywordHighlight(part, searchKeyword, { markClassName, keyPrefix: `${keyPrefix}${i}_` })
          : part),
  );
}

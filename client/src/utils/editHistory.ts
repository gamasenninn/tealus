/**
 * #344 候補3: MessageBubble の編集履歴 diff ペアリングを純関数として切り出し。
 * 編集履歴 (version DESC で届く) と現在の本文から、表示用の diff ペア列
 * (新しい変更が先頭) を作る。表示側は各ペアを diffChars で描画する。
 */

/** メッセージ編集履歴 1 件 (GET /messages/:id/edits、version DESC) */
export interface MessageEditEntry {
  version: number;
  content: string;
  created_at: string;
  edited_by_name?: string | null;
}

/** 編集履歴の 1 差分ステップ (prevText → nextText)。 */
export interface EditDiffPair {
  version: number;
  label: string;
  editorName: string | null;
  /** ISO 文字列 (表示側で toLocaleString)。最新→現在のステップは編集者不明で null */
  editorDate: string | null;
  prevText: string;
  nextText: string;
}

/**
 * editHistory (version DESC) を時系列 ASC に直し、各 version 間の diff ペアを作って
 * 新しい変更が上に来る順で返す。最新 version の nextText は currentContent。
 */
export function buildEditDiffPairs(editHistory: MessageEditEntry[], currentContent: string): EditDiffPair[] {
  const asc = [...editHistory].reverse();
  const pairs = asc.map((entry, i) => {
    const next = i < asc.length - 1 ? asc[i + 1] : null;
    return {
      version: entry.version,
      label: next ? `v${entry.version} → v${next.version}` : `v${entry.version} → 現在`,
      editorName: next?.edited_by_name ?? null,
      editorDate: next?.created_at ?? null,
      prevText: entry.content,
      nextText: next ? next.content : currentContent,
    };
  });
  return pairs.reverse();
}

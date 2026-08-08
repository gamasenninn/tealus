/**
 * #370 フォームの畳み込み状態を端末に覚えさせる。
 *
 * 「畳む」は「もう見なくていい」という意図なので、ルームを移動しても・リロードしても
 * 残るべき (component の state だけだと unmount で開いた状態に戻る)。
 * 横拡張 (expanded) は「いま見やすくしたい」なので、そちらは既存どおり残さない。
 *
 * ★ 畳んだ id を貯めるだけなので放置すると localStorage が太る。上限を設けて
 *   古いものから捨てる (溢れた分は「畳んでいない」に戻るだけで実害はない)。
 */
export const FORM_COLLAPSE_KEY = 'formCollapsed';
export const FORM_COLLAPSE_LIMIT = 200;

function read(): string[] {
  try {
    const raw = localStorage.getItem(FORM_COLLAPSE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // 壊れた値・配列でない値は「畳んでいない」に倒す (例外を投げて描画を壊さない)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(FORM_COLLAPSE_KEY, JSON.stringify(ids));
  } catch {
    // 容量超過・プライベートモード等。畳み込みが残らないだけで機能は動く
  }
}

export function isFormCollapsed(messageId: string): boolean {
  return read().includes(messageId);
}

export function setFormCollapsed(messageId: string, collapsed: boolean): void {
  const ids = read().filter((id) => id !== messageId);
  if (collapsed) {
    ids.push(messageId); // 末尾 = 最新。溢れたら先頭 (最古) から捨てる
    if (ids.length > FORM_COLLAPSE_LIMIT) ids.splice(0, ids.length - FORM_COLLAPSE_LIMIT);
  }
  write(ids);
}

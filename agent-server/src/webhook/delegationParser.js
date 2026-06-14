/**
 * `%` 委譲構文パーサ (#295)
 *
 * チャット投稿の先頭 `%` を「別 room への委譲」の trigger とする。
 *   例) `%社内DB検索 売上を集計して結果を教えて`
 *       → room=「社内DB検索」へ task=「売上を集計して結果を教えて」を委譲
 *
 * メンタルモデル: `@アシスタント`=この室の agent を呼ぶ / `%<room>`=別室へ委譲。
 *
 * 設計方針:
 *   - 純関数 (副作用なし)。room 一覧を引数で受け取り、DB query しない。
 *   - room 名は「最長一致」で確定する。room 名にスペースを含む場合があるため
 *     (例「小野哲 ↔ アシスタント」)、先頭トークン分割では壊れる。既知 room 名の
 *     うち入力の prefix になっているものから最長を選ぶ。room 名の直後は空白または
 *     文末でなければならない (= 途中一致での誤分割を防ぐ)。
 *   - 先頭 `%` だが解決できない場合も null ではなく { ok:false, reason } を返す。
 *     委譲元へエラーを返すため (silent fail 禁止)。
 *
 * @param {string} text  投稿本文
 * @param {Array<{id:string,name:string}>} rooms  既知 room 一覧
 * @returns {null | {ok:true, room:{id,string}, task:string}
 *               | {ok:false, reason:'room_not_found'|'empty_task'|'ambiguous', input:string}}
 *   先頭 `%` でなければ null (= 委譲でない)。
 */
function parseDelegation(text, rooms) {
  if (typeof text !== 'string') return null;

  const trimmed = text.replace(/^\s+/, '');
  if (trimmed[0] !== '%') return null;

  const rest = trimmed.slice(1);
  const list = Array.isArray(rooms) ? rooms : [];

  // room 名が rest の prefix で、かつ直後が空白 / 文末 (= clean な区切り) のものを候補に
  const candidates = list.filter((room) => {
    const name = room && room.name;
    if (!name || !rest.startsWith(name)) return false;
    const after = rest.charAt(name.length);
    return after === '' || /\s/.test(after);
  });

  if (candidates.length === 0) {
    return { ok: false, reason: 'room_not_found', input: rest };
  }

  // 最長一致
  const maxLen = Math.max(...candidates.map((r) => r.name.length));
  const longest = candidates.filter((r) => r.name.length === maxLen);
  if (longest.length > 1) {
    return { ok: false, reason: 'ambiguous', input: rest };
  }

  const room = longest[0];
  const task = rest.slice(room.name.length).trim();
  if (task === '') {
    return { ok: false, reason: 'empty_task', input: rest };
  }

  return { ok: true, room: { id: room.id, name: room.name }, task };
}

module.exports = { parseDelegation };

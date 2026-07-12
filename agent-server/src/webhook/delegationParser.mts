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
 * @param text  投稿本文
 * @param rooms  既知 room 一覧
 * @returns
 *   先頭 `%` でなければ null (= 委譲でない)。
 */
interface RoomRef {
  id: string;
  name: string;
}

type ParseDelegationResult =
  | null
  | { ok: true; room: RoomRef; task: string }
  | { ok: false; reason: 'room_not_found' | 'empty_task' | 'ambiguous'; input: string };

type ParseMultiDelegationResult =
  | null
  | { ok: true; targets: RoomRef[]; task: string }
  | { ok: false; reason: 'room_not_found' | 'ambiguous' | 'empty_task' | 'too_many_targets'; input?: string };

type ResolveLeadingRoomResult =
  | { room: RoomRef; consumedLen: number; error?: undefined }
  | { error: 'room_not_found' | 'ambiguous'; room?: undefined; consumedLen?: undefined };

// fan-out の最大委譲先数 (#295: 1 メッセージで叩ける room 数の上限、resource + throttle 保護)
const MAX_TARGETS = 5;

/**
 * `%` 直後の文字列 `rest` から、先頭にマッチする room を最長一致で1件解決する。
 * room 名の直後は空白 / 文末でなければならない (途中一致での誤分割防止)。
 */
function resolveLeadingRoom(rest: string, rooms: RoomRef[]): ResolveLeadingRoomResult {
  const list = Array.isArray(rooms) ? rooms : [];
  const candidates = list.filter((room) => {
    const name = room && room.name;
    if (!name || !rest.startsWith(name)) return false;
    const after = rest.charAt(name.length);
    return after === '' || /\s/.test(after);
  });
  if (candidates.length === 0) return { error: 'room_not_found' };

  const maxLen = Math.max(...candidates.map((r) => r.name.length));
  const longest = candidates.filter((r) => r.name.length === maxLen);
  if (longest.length > 1) return { error: 'ambiguous' };

  const room = longest[0];
  return { room: { id: room.id, name: room.name }, consumedLen: room.name.length };
}

function parseDelegation(text: string, rooms: RoomRef[]): ParseDelegationResult {
  if (typeof text !== 'string') return null;

  const trimmed = text.replace(/^\s+/, '');
  if (trimmed[0] !== '%') return null;

  const rest = trimmed.slice(1);
  const res = resolveLeadingRoom(rest, rooms);
  if (res.error) return { ok: false, reason: res.error, input: rest };

  const task = rest.slice(res.consumedLen).trim();
  if (task === '') {
    return { ok: false, reason: 'empty_task', input: rest };
  }
  return { ok: true, room: res.room, task };
}

/**
 * 複数 `%<room>` の fan-out をパースする (#295 真の多重委譲)。
 * `%朝礼 %終礼 %トランシーバー履歴 から日報を` → targets=[3室], task=「から日報を」
 * 先頭から連続する `%room` を全部 target に積み、`%` で始まらなくなった残りを共通 task に。
 */
function parseMultiDelegation(text: string, rooms: RoomRef[]): ParseMultiDelegationResult {
  if (typeof text !== 'string') return null;

  let cursor = text.replace(/^\s+/, '');
  if (cursor[0] !== '%') return null;

  const targets: RoomRef[] = [];
  const seen = new Set<string>();

  while (cursor.startsWith('%')) {
    const rest = cursor.slice(1);
    const res = resolveLeadingRoom(rest, rooms);
    if (res.error) return { ok: false, reason: res.error, input: rest };
    if (!seen.has(res.room.id)) {
      seen.add(res.room.id);
      targets.push(res.room);
    }
    // room 名 + 後続空白を消費して次へ
    cursor = rest.slice(res.consumedLen).replace(/^\s+/, '');
  }

  if (targets.length > MAX_TARGETS) {
    return { ok: false, reason: 'too_many_targets' };
  }
  const task = cursor.trim();
  if (task === '') {
    return { ok: false, reason: 'empty_task' };
  }
  return { ok: true, targets, task };
}

export { parseDelegation, parseMultiDelegation, MAX_TARGETS };

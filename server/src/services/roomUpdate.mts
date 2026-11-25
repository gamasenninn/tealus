/**
 * 部屋の設定の保存 (PUT /api/rooms/:id) で、来た項目をどの列にどう書くか・何を断るか。改善ループ 113 で道から出した。
 *
 * ★ 返すのは [列名, 値] の並び。SQL のプレースホルダの番号は道の側で振る (ここで番号を持つと、順を崩したときに別の列に書く)。
 * ★ 断る順は「お知らせ (403) → 項目の順に名前・アプリの URL・push_machine_posts (400) → 何も無い (400)」。道の中にあったときのまま。
 * ★ message_edit_policy・allow_member_transcription_edit・voice_conversation_enabled と道具の 2 つは、値を確かめずに通す
 *   (今の動き。確かめを足すのは動きの変更なので別にする)。
 */
import { isValidAppUrls } from '../utils/webUrl.mts';

/**
 * グループ名は DB の列 (rooms.name VARCHAR(100)) と同じ 100 字まで (改善ループ 18 回目)。
 * ★ 以前は長さを見ず、101 字以上は DB の例外で 500 になっていた (表示名・一言は #498 で同じ直しをしてある)
 */
export const ROOM_NAME_MAX = 100;
export const ROOM_NAME_ERROR = `グループ名は ${ROOM_NAME_MAX} 字までです`;
export const isValidRoomName = (name: unknown): boolean => typeof name === 'string' && name.trim() !== '' && name.length <= ROOM_NAME_MAX;

export type RoomUpdateResult =
  | { ok: true; sets: Array<[string, unknown]> }
  | { ok: false; status: 400 | 403; error: string };

export function buildRoomUpdate(body: Record<string, unknown>, { isSystemAdmin }: { isSystemAdmin: boolean }): RoomUpdateResult {
  const {
    name, allow_member_transcription_edit, is_announcement, app_urls, message_edit_policy,
    voice_conversation_enabled, voice_conversation_tools, voice_conversation_denied_tools, push_machine_posts,
  } = body;

  // ★ #540 お知らせの切り替えはシステム管理者だけ (画面もシステム管理者にだけ出している)。
  //   以前は部屋の管理者でも通り、画面と本体で決まりが食い違っていた
  if (is_announcement !== undefined && !isSystemAdmin) {
    return { ok: false, status: 403, error: 'お知らせの切り替えはシステム管理者だけができます' };
  }

  const sets: Array<[string, unknown]> = [];
  if (name !== undefined) {
    if (!isValidRoomName(name)) return { ok: false, status: 400, error: ROOM_NAME_ERROR };
    sets.push(['name', name]);
  }
  if (allow_member_transcription_edit !== undefined) sets.push(['allow_member_transcription_edit', allow_member_transcription_edit]);
  if (is_announcement !== undefined) sets.push(['is_announcement', is_announcement]);
  if (app_urls !== undefined) {
    if (!isValidAppUrls(app_urls)) return { ok: false, status: 400, error: 'アプリの URL は http:// か https:// で始めてください' };
    sets.push(['app_urls', JSON.stringify(app_urls)]);
  }
  if (message_edit_policy !== undefined) sets.push(['message_edit_policy', message_edit_policy]);
  // #405 Realtime 音声会話 (docs/08 §12)。既定 false = 開けたルームにだけ入口が出る
  if (voice_conversation_enabled !== undefined) sets.push(['voice_conversation_enabled', voice_conversation_enabled]);
  // #405 会話モードで上乗せする道具の名前。★ requireRoomAdmin で守られているのがここに置く理由
  // ★ #418 で意味を「既定で外れている道具を戻す」に読み替えた (docs/08 §12.17)。列名はそのまま
  if (voice_conversation_tools !== undefined) sets.push(['voice_conversation_tools', JSON.stringify(voice_conversation_tools)]);
  // #418 会話モードで外す道具。★ 既定は空 = 何もしなければ 1 つも外れない
  if (voice_conversation_denied_tools !== undefined) sets.push(['voice_conversation_denied_tools', JSON.stringify(voice_conversation_denied_tools)]);
  // #463 機械 (is_bot) の投稿でも通知を鳴らすか。既定 false。★ 管理者だけが変えられる (requireRoomAdmin)
  if (push_machine_posts !== undefined) {
    if (typeof push_machine_posts !== 'boolean') return { ok: false, status: 400, error: 'push_machine_posts は true / false で指定してください' };
    sets.push(['push_machine_posts', push_machine_posts]);
  }

  if (sets.length === 0) return { ok: false, status: 400, error: '更新する項目がありません' };
  return { ok: true, sets };
}

/**
 * 11-28 利用者の案 A (マルチトークのパネル): 広げた入力欄の下に、いちばん下の投稿が隠れて返事が書きにくい。
 * トークの下に、入力欄が重なる高さぶんの余白を足してずらすか、を決める。
 * ★ ずらすのは「いちばん下を見ているときに広げた」ときだけ。上の方を読んでいる途中なら今どおり重ねる
 *   (#513「広げるときは重ねる・見ていた位置がずれない」を、読んでいる途中の場合には守る)
 * ★ もうずらしている間は、入力欄の背が変われば (行が増えた・返信先が付いた) 量を合わせる
 */
import { SCROLL_NEAR_BOTTOM } from '../constants/ui';

interface ScrollBox { scrollHeight: number; scrollTop: number; clientHeight: number }

/** 新しいずらす量 (px)。overlap = 広げた入力欄がトークに重なる高さ、current = 今ずらしている量 */
export function composerShift(box: ScrollBox, overlap: number, current: number): number {
  if (!Number.isFinite(overlap) || overlap <= 0) return 0;
  if (current > 0) return overlap;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < SCROLL_NEAR_BOTTOM;
  return nearBottom ? overlap : 0;
}

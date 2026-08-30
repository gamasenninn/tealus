/**
 * 長すぎるエラー文字列を、原因の手がかりを残したまま切り詰める。
 *
 * ★ 2026-08-30 実測: codex を kill すると、models 一覧の JSON を丸ごと含む
 *   **164,976 文字**のエラーが stream から返る。これを
 *
 *   - log に全文出す → **1 行でその日のログの 62%** を占める
 *   - 部屋に全文投げる → **16 万字のメッセージが user に届く**
 *
 *   という 2 経路で流していた。codex が落ちれば毎回この形になるので、
 *   偶発ではなく構造的に起きる。
 *
 * ★ 切り捨てた分は「全長 N 文字」として必ず残す。**黙って消さない**
 *   (消えたことに気づけないと、次に同じ調査をやり直すことになる)。
 */
export function briefError(message: string, max = 300): string {
  if (message.length <= max) return message;
  const brief = `${message.slice(0, max)}… 全長 ${message.length} 文字`;
  // ★ 縮まないなら切らない。上限をわずかに超えただけだと、接尾辞のぶん逆に長くなる。
  return brief.length < message.length ? brief : message;
}

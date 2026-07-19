/**
 * @メンション検知（依存ゼロの純関数）。
 *
 * dispatcher と handler の両方が使う。handler(webhook) 側は dispatcher をテストで
 * mock するため、mention 判定を dispatcher から切り離して重い依存を持ち込まないようにする。
 */
export function isMentioned(content: unknown, agentName: string | null | undefined): boolean {
  if (typeof content !== 'string' || !agentName) return false;
  // 先頭メンションのみ反応する (先行空白は許容)。
  // 文中・例示・引用・末尾の @mention では誤発火しないようにする (cc-tealus #215 と同方針)。
  // 「明示的に呼び出す意識」がある先頭メンションだけを応答 trigger とする。
  const escaped = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^@${escaped}`, 'i');
  return pattern.test(content.replace(/^\s+/, ''));
}

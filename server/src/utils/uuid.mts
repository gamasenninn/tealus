/**
 * ID (UUID) の形を確かめる (2026-09-29 システムチェック)。
 *
 * ★ 形の崩れた ID (会話モードの AI が「754...」「f3ee3f54...」と省略して渡した) を確かめずに DB に投げ、
 *   500 (invalid input syntax for type uuid) を返していた。AI や画面が読んで直せるよう、400 と理由を返す。
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** 400 に載せる理由。渡された値をそのまま見せる (どこを直せばよいかが分かるように) */
export function badIdMessage(value: string): string {
  return `ID「${value.slice(0, 60)}」の形が正しくありません。ID は省略せずに、36 文字のまま渡してください。`;
}

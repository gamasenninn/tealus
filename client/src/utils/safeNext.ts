/**
 * ログインのあとに戻る先 (`/login?next=…`)。★ アプリの中のパスだけ通し、よそへ出る形は "/" に倒す
 * (`//evil.example.com` や `/\evil.example.com` はブラウザがよそのサイトとして読む。docs/11 §5.5)
 * ★ タブ・改行と \ もはじく。ブラウザは URL のタブ・改行を取り除くので、`/<タブ>/evil` は `//evil` と読まれる
 *   (Fable の点検 2026-11-17)
 */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || UNSAFE_CHARS.test(raw)) return '/';
  return raw;
}

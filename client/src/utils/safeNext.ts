/**
 * ログインのあとに戻る先 (`/login?next=…`)。★ アプリの中のパスだけ通し、よそへ出る形は "/" に倒す
 * (`//evil.example.com` や `/\evil.example.com` はブラウザがよそのサイトとして読む。docs/11 §5.5)
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

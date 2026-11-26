/**
 * 署名つきの札 (appPass・appLogin、docs/11) の base64url。改善ループ 130 で 2 か所の写しをここに 1 つにした
 */
export function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

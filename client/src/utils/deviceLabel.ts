/**
 * 通知の送り先の登録に付ける短い端末名 (2026-09-29)。
 *
 * push_subscriptions.device_name は欄だけあって、一度も送っていなかった。
 * 登録が何件あっても、どれがどの端末かを見分けられず、「同じ通知が重なって鳴っていないか」を確かめられなかった。
 * ★ UA を丸ごとは入れない。OS・ブラウザ・アプリとして開いているかだけ
 */
export function deviceLabel(ua: string, standalone: boolean): string {
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  // ★ Edge の UA には Chrome も、Chrome の UA には Safari も入っているので、この順で見る
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /(Chrome|CriOS)\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  if (!os && !browser) return '不明';
  const label = [os, browser].filter(Boolean).join(' ') + (standalone ? ' (アプリ)' : '');
  return label.slice(0, 100);
}

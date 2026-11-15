import { isWebUrl } from './webUrl';

type OpenFn = (url: string, target: string) => Window | null;

/**
 * アプリを別のタブで開く (2026-11-15、EC の管理画面を PC で全画面に開くため。docs/11 §5.3)。
 * - ★ 押した瞬間 (クリックの中) に空のタブを開き、通行証を取ってから移す。取り終わってから開くと、ブラウザがポップアップとして止める
 * - ★ 開いたタブの opener を切る。相手のページから Tealus のタブを書き換えられないように
 * - 通行証が取れなかったら元の URL (iframe と同じ。壊れない)。添えないアプリは元の URL をそのまま
 * - http / https 以外は開かない
 */
export async function openAppInNewTab(
  app: { url: string; pass?: boolean },
  fetchPass: () => Promise<{ url: string }>,
  open: OpenFn = (u, t) => window.open(u, t),
): Promise<void> {
  if (!isWebUrl(app.url)) return;
  const tab = open('about:blank', '_blank');
  if (!tab) return;   // ブラウザが止めた
  tab.opener = null;
  let dest = app.url;
  if (app.pass) {
    try { dest = (await fetchPass()).url; } catch { dest = app.url; }
  }
  tab.location.href = dest;
}

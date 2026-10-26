import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { AppUrl, PortalLink } from '../types';
import { isWebUrl } from '../utils/webUrl';

const BLANK = 'about:blank';

/**
 * #607 iframe に入れる URL (docs/11 §5.3)。部屋のアプリとホームのタブで共通の中身。
 * - 通行証を添えるものは、通行証つきの入口 URL を取ってから開く
 * - 取れなかったら元の URL で開く (今と同じくベーシック認証が出る。壊れない)
 * - 開き直すたび (閉じて開く・切り替える) に取り直す。★ 通行証は 2 分で切れる
 *
 * ★ 取れるまでは about:blank。先に元の URL を開くと、iPhone ではその間にパスワードの箱が出る
 * @param fetchKey これが変わったら取り直す (アプリの url と番号、リンクの ID)
 */
function usePassUrl(
  url: string | undefined, needsPass: boolean, open: boolean, fetchKey: string, fetchPass: () => Promise<{ url: string }>,
): string {
  const [passUrl, setPassUrl] = useState<string | null>(null);

  useEffect(() => {
    setPassUrl(null);
    if (!open || !url || !needsPass || !isWebUrl(url)) return;
    let current = true;  // ★ 遅れて返った前の通行証で、今のものを上書きしない
    fetchPass()
      .then((r) => { if (current) setPassUrl(r.url); })
      .catch(() => { if (current) setPassUrl(url); });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPass は毎回作り直されるので fetchKey で見る
  }, [fetchKey, url, needsPass, open]);

  // ★ http / https 以外 (前に保存された分も) は開かない
  if (!url || !isWebUrl(url)) return BLANK;
  if (!needsPass) return url;
  return passUrl ?? BLANK;
}

/** 部屋のアプリパネル */
export function useAppPassUrl(roomId: string, app: AppUrl | undefined, index: number, open: boolean): string {
  return usePassUrl(app?.url, !!app?.pass, open, `${roomId}:${index}:${app?.url ?? ''}`,
    () => api.getAppPass(roomId, index, app!.url));
}

/** ホーム画面のタブ (portal_links)。★ 部屋のアプリと別の作りなので、ここを付け忘れて案内ページになった */
export function usePortalPassUrl(link: Pick<PortalLink, 'id' | 'url' | 'pass'> | undefined, open: boolean): string {
  return usePassUrl(link?.url, !!link?.pass, open, link?.id ?? '', () => api.getPortalAppPass(link!.id));
}

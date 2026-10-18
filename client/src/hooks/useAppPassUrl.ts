import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { AppUrl } from '../types';

const BLANK = 'about:blank';

/**
 * #607 アプリパネルの iframe に入れる URL (docs/11 §5.3)。
 * - 「通行証を添える」(pass) が付いたアプリは、通行証つきの入口 URL を取ってから開く
 * - 取れなかったら元の URL で開く (今と同じくベーシック認証が出る。壊れない)
 * - 開き直すたび (パネルを閉じて開く・アプリを替える) に取り直す。★ 通行証は 2 分で切れる
 *
 * ★ 取れるまでは about:blank。先に元の URL を開くと、iPhone ではその間にパスワードの箱が出る
 */
export function useAppPassUrl(roomId: string, app: AppUrl | undefined, index: number, open: boolean): string {
  const needsPass = !!app?.pass;
  const [passUrl, setPassUrl] = useState<string | null>(null);

  useEffect(() => {
    setPassUrl(null);
    if (!open || !app || !needsPass) return;
    let current = true;  // ★ 遅れて返った前の通行証で、今のアプリを上書きしない
    api.getAppPass(roomId, index, app.url)
      .then((r) => { if (current) setPassUrl(r.url); })
      .catch(() => { if (current) setPassUrl(app.url); });
    return () => { current = false; };
  }, [roomId, app?.url, needsPass, index, open]);

  if (!app) return BLANK;
  if (!needsPass) return app.url;
  return passUrl ?? BLANK;
}

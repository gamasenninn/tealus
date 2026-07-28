import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { BUILD_ID, isStale } from '../utils/buildVersion';

/**
 * #356 実行中のバンドルが古くなっていないかを、Service Worker に頼らず自力で確かめる。
 *
 * iOS の standalone PWA は SW の更新チェックが不発になりがちで、precache から古い画面を
 * 返し続ける。`GET /api/version` は precache 対象外かつ navigateFallbackDenylist にも
 * 入っているため、この fetch だけは必ずネットワークに届く。ここが検知の生命線。
 *
 * 一番効く契機は「前面に戻ったとき」。iOS の PWA はサスペンドから復帰するだけで
 * ナビゲーションが起きず、SW の更新チェックが走らないため。
 */

/** 定期確認の間隔。前面復帰でも確認するので、これは長く開いたままの端末向けの保険 */
const POLL_INTERVAL_MS = 30 * 60 * 1000;

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [serverBuildId, setServerBuildId] = useState<string | null>(null);
  // 一度検知したら取り消さない (オフラインでの取得失敗でバナーを消さない)
  const detectedRef = useRef(false);

  const check = useCallback(async () => {
    try {
      const res = await api.getVersion();
      const server = res?.build_id ?? null;
      setServerBuildId(server);
      if (isStale(BUILD_ID, server)) {
        detectedRef.current = true;
        setUpdateAvailable(true);
      }
    } catch {
      // オフライン / サーバ停止で誤検知させない。黙って次の契機を待つ
    }
  }, []);

  useEffect(() => {
    check();
    const onVisible = () => { if (!document.hidden) check(); };
    // jsdom では document.hidden が常に false。実機でも復帰時は false なので条件は同じ
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [check]);

  return { updateAvailable, buildId: BUILD_ID, serverBuildId };
}

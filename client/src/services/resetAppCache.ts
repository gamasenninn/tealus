import { unregisterPushNotification } from './pushNotification';

/**
 * 古い画面を捨てて読み直す準備 (「新しいバージョン」の更新 / プロフィールのキャッシュクリア)。
 * 呼んだ側が最後に location.reload() する。
 *
 * ★ #528 サービスワーカーを消す前に、プッシュの宛先を本体から外す。
 *   消すとブラウザの中では宛先も消えるが、本体には知らせていなかった。読み込み直すたびに新しい宛先の行ができ、
 *   古い行は送って 410 が返るまで有効のまま溜まった (小野さん 半年 480 行)。読み込み直した画面が登録し直す
 * ★ #356 caches / serviceWorker が無い環境でも投げない。どの段が失敗しても次へ進む (更新を止めない)
 */
export async function resetAppCache(): Promise<void> {
  await unregisterPushNotification();   // 失敗しても投げない (ログアウトと同じ処理、#508)
  try {
    if (typeof caches !== 'undefined' && caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.warn('cache clear failed:', err);
  }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs || []).map((r) => r.unregister()));
  } catch (err) {
    console.warn('sw unregister failed:', err);
  }
}

import { rememberCurrentEndpoint } from './pushNotification';

/**
 * 古い画面を捨てて読み直す準備 (「新しいバージョン」の更新 / プロフィールのキャッシュクリア)。
 * 呼んだ側が最後に location.reload() する。
 *
 * ★ #528 本体に古い宛先の行を溜めない。以前は何もせずにサービスワーカーを消していたので、読み込み直すたびに
 *   新しい宛先の行ができ、古い行は送って 410 が返るまで有効のまま溜まった (小野さん 半年 480 行)。
 * ★★ #546 ただしブラウザの宛先は外さない。今の宛先を覚えるだけにして、読み込み直した画面が登録できたあとで
 *   変わっていれば古い方を本体から外す (registerPushNotification)。#528 の初版は外していて、iPhone は利用者の
 *   タップなしでは宛先を作り直せず、更新した人に通知が届かなくなった
 * ★ #356 caches / serviceWorker が無い環境でも投げない。どの段が失敗しても次へ進む (更新を止めない)
 */
export async function resetAppCache(): Promise<void> {
  await rememberCurrentEndpoint();   // 失敗しても投げない
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

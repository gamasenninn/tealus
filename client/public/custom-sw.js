// Tealus カスタム Service Worker — プッシュ通知 + Web Share Target

// --- プッシュ通知 ---
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const { title, body, data: notifData, total_unread } = data;

  // SPIKE (5/12): App Badge — ホーム画面アイコン上に未読数表示 (PWA 機能)
  // iOS Safari 16.4+ (PWA installed) / Chrome / Edge で対応、Firefox は silent fail
  if ('setAppBadge' in self.navigator) {
    if (total_unread && total_unread > 0) {
      self.navigator.setAppBadge(total_unread).catch(() => {});
    } else {
      self.navigator.clearAppBadge().catch(() => {});
    }
  }

  event.waitUntil(
    self.registration.showNotification(title || 'Tealus', {
      body: body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: notifData?.roomId ? `room-${notifData.roomId}` : 'tealus',
      renotify: true,
      data: notifData,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;
  const targetUrl = roomId ? `/rooms/${roomId}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('navigate' in client) {
          return client.navigate(targetUrl).then((c) => c.focus());
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// --- Web Share Target ---
//
// ★★★★★ 2026-09-18 (#445): 受け取った中身の「点呼」を 1 件だけ残す。
//
// ★ 09-17 から「共有すると画面は開くがファイルが入らない」が続き、端末に触れないまま
//   黒箱で 7 つ潰して、★★ 最後は **Chrome のバージョン差** (153 で壊れ / 141 で動く) に着いた。
//   ★★★ リリースノートにも既知の記録が無い = **次も推測で追うことになる**。
// → ★★★★ 次に失敗したとき、推測ではなく **1 行の事実**が残るようにする。
//
// ★★ 記録は **一度きり** (画面が読んだら消す)。★★★ URL に印を置くと
//   **再訪 (履歴 / 再読み込み) で残って、生きている失敗と見分けがつかなくなる**。
const SW_VERSION = '2026-09-18a';

/** 画面からの問い合わせに答える。★ 旧版はこの listener を持たないので **黙る** = 版が分かる。 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'share-diag') {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage({ type: 'share-diag-reply', version: SW_VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith((async () => {
      const cache = await caches.open('share-target');
      // ★ 前回の残りを先に消す (★★ 記録もファイルもまとめて。再訪で古い記録を読ませない)
      const keys = await cache.keys();
      await Promise.all(keys.map((k) => cache.delete(k)));

      let fields = [];
      let media = [];
      let text = '';
      let title = '';
      let shareUrl = '';
      let parseError = '';
      try {
        const formData = await event.request.formData();
        // ★ 点呼は **絞る前**に取る。★★ 「media が 0 件」と「media フィールドが無い」は別の話
        for (const key of formData.keys()) if (!fields.includes(key)) fields.push(key);
        text = formData.get('text') || '';
        title = formData.get('title') || '';
        shareUrl = formData.get('url') || '';
        media = formData.getAll('media');
      } catch (err) {
        // ★ 黙って落とさない。★★ respondWith が reject するとブラウザのエラー画面になり、
        //   **こちらには何も残らない**
        parseError = String((err && err.message) || err);
      }

      const sizes = media.map((f) => (f && typeof f.size === 'number' ? f.size : -1));
      const files = media.filter((f) => f && f.size > 0);

      for (let i = 0; i < files.length; i++) {
        await cache.put(`/share-file-${i}`, new Response(files[i]));
      }

      // ★★★★ 一度きりの記録。★ 画面が読んだら消す
      await cache.put(
        '/share-diag',
        new Response(
          JSON.stringify({
            fields,
            mediaCount: media.length,
            zeroSized: sizes.filter((s) => s === 0).length,
            sizes,
            parseError,
            swVersion: SW_VERSION,
            t: Date.now(),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      // GET にリダイレクト
      const params = new URLSearchParams();
      if (text) params.set('text', text);
      if (title) params.set('title', title);
      if (shareUrl) params.set('url', shareUrl);
      if (files.length > 0) params.set('files', files.length);
      // ★ 二重の保険 (★★ 判定の主は「記録の有無」であって、これではない)
      params.set('via', 'sw');
      params.set('t', String(Date.now()));

      return Response.redirect(`/share?${params}`, 303);
    })());
  }
});

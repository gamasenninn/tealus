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
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const text = formData.get('text') || '';
      const title = formData.get('title') || '';
      const shareUrl = formData.get('url') || '';
      const files = formData.getAll('media').filter((f) => f.size > 0);

      // ファイルがあれば Cache API に一時保存
      if (files.length > 0) {
        const cache = await caches.open('share-target');
        // 古いキャッシュをクリア
        const keys = await cache.keys();
        await Promise.all(keys.map((k) => cache.delete(k)));
        // 新しいファイルを保存
        for (let i = 0; i < files.length; i++) {
          await cache.put(`/share-file-${i}`, new Response(files[i]));
        }
      }

      // GET にリダイレクト
      const params = new URLSearchParams();
      if (text) params.set('text', text);
      if (title) params.set('title', title);
      if (shareUrl) params.set('url', shareUrl);
      if (files.length > 0) params.set('files', files.length);

      return Response.redirect(`/share?${params}`, 303);
    })());
  }
});

// Tealus カスタム Service Worker — プッシュ通知ハンドラ

self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const { title, body, data: notifData } = data;

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
      // 既存のクライアントがあれば navigate で遷移（メッセージ再取得を強制）
      for (const client of clientList) {
        if ('navigate' in client) {
          return client.navigate(targetUrl).then((c) => c.focus());
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

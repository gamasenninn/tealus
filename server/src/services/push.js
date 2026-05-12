const logger = require('../utils/logger');
const webpush = require('web-push');
const pool = require('../db/pool');

// Configure VAPID keys (set in .env)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@tealus.local',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

/**
 * SPIKE (5/12): user の全 room 未読合計を計算 (App Badge 用)。
 * Badging API は home icon 上に未読数を表示する PWA 機能、push payload に含めて
 * Service Worker で `navigator.setAppBadge(count)` を call する設計。
 */
async function calculateTotalUnreadForUser(userId) {
  try {
    const r = await pool.query(`
      SELECT COALESCE(SUM(unread_count), 0)::int AS total
      FROM (
        SELECT COUNT(*)::int AS unread_count
        FROM messages msg
        JOIN room_members rm ON rm.room_id = msg.room_id
        WHERE rm.user_id = $1
          AND msg.is_deleted = false
          AND msg.sender_id != $1
          AND msg.created_at > COALESCE(
            (SELECT last_read_at FROM room_read_cursors WHERE room_id = msg.room_id AND user_id = $1),
            '1970-01-01'
          )
        GROUP BY msg.room_id
      ) sub
    `, [userId]);
    return r.rows[0]?.total || 0;
  } catch (err) {
    logger.warn('calculateTotalUnreadForUser failed:', err.message);
    return 0;
  }
}

/**
 * Send push notifications to all subscriptions of a user.
 * @param {string} userId - Target user ID
 * @param {object} payload - Notification payload { title, body, data }
 */
async function sendPushToUser(userId, payload) {
  try {
    const result = await pool.query(
      'SELECT * FROM push_subscriptions WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    logger.debug(`push: user=${userId} subscriptions=${result.rows.length} title=${payload.title}`);

    // SPIKE: 全 room 未読合計を計算して payload に追加 (App Badge 用)
    const totalUnread = await calculateTotalUnreadForUser(userId);
    const enrichedPayload = { ...payload, total_unread: totalUnread };

    const notifications = result.rows.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh_key,
          auth: sub.auth_key,
        },
      };

      try {
        await webpush.sendNotification(
          pushSubscription,
          JSON.stringify(enrichedPayload)
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired or invalid — mark inactive
          await pool.query(
            'UPDATE push_subscriptions SET is_active = false WHERE id = $1',
            [sub.id]
          );
        }
        logger.error(`Push failed for ${sub.endpoint}:`, err.statusCode || err.message);
      }
    });

    await Promise.all(notifications);
  } catch (err) {
    logger.error('sendPushToUser error:', err);
  }
}

/**
 * Send push notification to all offline members of a room.
 * @param {string} roomId - Room ID
 * @param {string} senderId - Sender's user ID (excluded from push)
 * @param {object} payload - Notification payload
 * @param {Set<string>} onlineUserIds - Set of currently connected user IDs
 */
async function sendPushToOfflineMembers(roomId, senderId, payload, onlineUserIds) {
  try {
    const members = await pool.query(
      'SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2',
      [roomId, senderId]
    );

    for (const member of members.rows) {
      if (!onlineUserIds.has(member.user_id)) {
        await sendPushToUser(member.user_id, payload);
      }
    }
  } catch (err) {
    logger.error('sendPushToOfflineMembers error:', err);
  }
}

module.exports = { sendPushToUser, sendPushToOfflineMembers };

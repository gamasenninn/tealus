const logger = require('../utils/logger');
const webpush = require('web-push');
const pool = require('../db/pool');

// Configure VAPID keys (set in .env)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@linny.local',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
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
          JSON.stringify(payload)
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

import { logger } from '../utils/logger.mts';
import webpush from 'web-push';
import { pool } from '../db/pool.mts';

/**
 * VAPID の連絡先 (subject) の点検。問題が無ければ null (2026-09-27)
 * ★ 本番で Apple 宛てが全部 403 {"reason":"BadJwtToken"} だった。連絡先が既定値の
 *   `mailto:admin@tealus.local` で、Apple は実在しないドメイン (.local / localhost) を受け付けない。
 *   403 の理由をログに出すまで気づけなかったので、起動時に言う。
 */
export function vapidSubjectProblem(subject: string | undefined): string | null {
  if (!subject) return 'VAPID_SUBJECT が未設定です (既定の mailto:admin@tealus.local では Apple (iPhone) に届きません)';
  let host: string;
  if (subject.startsWith('mailto:')) host = subject.slice(7).split('@')[1] ?? '';
  else if (subject.startsWith('https:')) {
    try { host = new URL(subject).hostname; } catch { host = ''; }
  } else return `VAPID_SUBJECT は mailto: か https: で始めてください (現在の形では送り先に断られます)`;
  host = host.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) {
    return 'VAPID_SUBJECT の連絡先が実在しないドメインです。Apple (iPhone) への通知が 403 BadJwtToken で断られます。実在するメールアドレスか https の URL にしてください';
  }
  return null;
}

// Configure VAPID keys (set in .env)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  const problem = vapidSubjectProblem(process.env.VAPID_SUBJECT);
  if (problem) logger.warn(`[push] ${problem}`);
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@tealus.local',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

/** 通知ペイロード { title, body, data } */
interface PushPayload {
  title: string;
  [key: string]: unknown;
}

/** push_subscriptionsテーブルの行 */
interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  device_name: string | null;
  is_active: boolean;
}

/**
 * SPIKE (5/12): user の全 room 未読合計を計算 (App Badge 用)。
 * Badging API は home icon 上に未読数を表示する PWA 機能、push payload に含めて
 * Service Worker で `navigator.setAppBadge(count)` を call する設計。
 */
async function calculateTotalUnreadForUser(userId: string): Promise<number> {
  try {
    // ★ 既読位置はルームごとに先に結合する (2026-09-28)。メッセージ 1 行ごとに引く書き方だと、
    //   索引で「既読より後」に絞れず全メッセージを読んでいた (本番の最大 539ms → 23ms、29 人で数は全員一致)
    const r = await pool.query<{ total: number }>(`
      SELECT COUNT(*)::int AS total
      FROM room_members rm
      LEFT JOIN room_read_cursors rc ON rc.room_id = rm.room_id AND rc.user_id = rm.user_id
      JOIN messages msg ON msg.room_id = rm.room_id
                       AND msg.created_at > COALESCE(rc.last_read_at, '1970-01-01')
      WHERE rm.user_id = $1
        AND msg.is_deleted = false
        AND msg.sender_id != $1
    `, [userId]);
    return r.rows[0]?.total || 0;
  } catch (err) {
    logger.warn('calculateTotalUnreadForUser failed:', err instanceof Error ? err.message : String(err));
    return 0;
  }
}

/**
 * プッシュの失敗を 1 行にする (2026-09-27)。
 * ★ Apple 宛ての 403 が続いている (9/26 に 47 回) が、状態コードしか残しておらず、
 *   **相手が返した理由 (本文の reason)** が無いと直し方を決められなかった。
 * ★ 送り先 URL は鍵のようなもの (知っていれば送れる) なので、ホスト名と登録 id だけ書く。
 */
export function describePushFailure(err: unknown, sub: Pick<PushSubscriptionRow, 'id' | 'endpoint' | 'device_name'>): string {
  const e = err as { statusCode?: number; body?: unknown; message?: string };
  let host = '?';
  try { host = new URL(sub.endpoint).host; } catch { /* 壊れた endpoint でもログは書く */ }
  const body = typeof e.body === 'string' ? e.body.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const detail = body || (err instanceof Error ? err.message : String(err));
  return `Push failed: status=${e.statusCode ?? '-'} reason=${detail || '-'} host=${host} sub=${sub.id.slice(0, 8)} device=${sub.device_name ?? '-'}`;
}

/**
 * Send push notifications to all subscriptions of a user.
 * @param userId - Target user ID
 * @param payload - Notification payload { title, body, data }
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    const result = await pool.query<PushSubscriptionRow>(
      'SELECT * FROM push_subscriptions WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    logger.debug(`push: user=${userId} subscriptions=${result.rows.length} title=${payload.title}`);
    // ★ 送り先が無ければ未読も数えない (2026-09-28)。数えていた頃は送らない人の分まで集計が走り、
    //   テストでは裏に残ったこの集計が次のテストの TRUNCATE とデッドロックしていた
    if (result.rows.length === 0) return;

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
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired or invalid — mark inactive
          await pool.query(
            'UPDATE push_subscriptions SET is_active = false WHERE id = $1',
            [sub.id]
          );
        }
        // ★ 403 はまだ無効にしない —— 理由を見てから決める
        logger.error(describePushFailure(err, sub));
      }
    });

    await Promise.all(notifications);
  } catch (err) {
    logger.error('sendPushToUser error:', err);
  }
}

/**
 * Send push notification to all offline members of a room.
 * @param roomId - Room ID
 * @param senderId - Sender's user ID (excluded from push)
 * @param payload - Notification payload
 * @param onlineUserIds - Set of currently connected user IDs
 */
export async function sendPushToOfflineMembers(roomId: string, senderId: string, payload: PushPayload, onlineUserIds: Set<string>): Promise<void> {
  try {
    const members = await pool.query<{ user_id: string }>(
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

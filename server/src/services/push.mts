import { logger } from '../utils/logger.mts';
import webpush from 'web-push';
import { pool } from '../db/pool.mts';
import { viewingUserIds } from '../socket/viewingRooms.mts';

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
export interface PushPayload {
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
                       AND msg.created_at > COALESCE(rc.last_read_at, rm.joined_at)   -- ★ 既読位置が無ければ入った時刻から (docs/02)
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
      // ★ #529 利用停止にした人には送らない (停止は接続を切るが、プッシュは届き続けていた。端末側からは外せない)
      `SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
        WHERE ps.user_id = $1 AND ps.is_active = true AND u.is_active = true`,
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
            'UPDATE push_subscriptions SET is_active = false, updated_at = now() WHERE id = $1',
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
 * ルームのメンバーに通知を送る。送り手と、その部屋をいま見ている人は除く。
 *
 * ★ #475 (2026-09-29): 以前は「どの端末からでも接続している人」を除いていた (sendPushToOfflineMembers)。
 *   PC を開いたままだとスマホに 1 件も届かなかった。除くのは「その部屋を開いていて画面が見えている人」だけにした。
 * ★ viewing を渡さなければ viewingRooms から引く。呼ぶ側で集合を作らせない (作り間違えると黙って鳴らなくなる)。
 * @param roomId - Room ID
 * @param senderId - Sender's user ID (excluded from push)
 * @param payload - Notification payload
 * @param viewing - その部屋をいま見ている利用者 (テスト以外では渡さない)
 */
export async function sendPushToRoomMembers(
  roomId: string, senderId: string, payload: PushPayload,
  viewing: Set<string> = new Set(viewingUserIds(roomId)),
): Promise<void> {
  try {
    const members = await pool.query<{ user_id: string; notification_sound: boolean }>(
      // ★ #463 このルームを鳴らさないにしている人は除く (通話の着信は sendPushToUser を直接呼ぶので影響しない)
      `SELECT rm.user_id, u.notification_sound
         FROM room_members rm JOIN users u ON u.id = rm.user_id
        WHERE rm.room_id = $1 AND rm.user_id != $2 AND rm.push_muted = false
          AND u.is_active = true     -- ★ #529 利用停止にした人は除く
          AND NOT u.is_bot`,         // ★ 10-16 機械には送らない (送り先の 61% が宛先 0 本の機械で、毎回空振りしていた)
      [roomId, senderId]
    );

    for (const member of members.rows) {
      if (!viewing.has(member.user_id)) {
        // ★ 通知音を切っている人には、通知は出して音だけ止める (2026-10-08、iPhone で効くことを確かめた)
        await sendPushToUser(member.user_id, member.notification_sound ? payload : { ...payload, silent: true });
      }
    }
  } catch (err) {
    logger.error('sendPushToRoomMembers error:', err);
  }
}

/**
 * 30 日 (既定) 送り直されない通知の宛先を外す (2026-10-16、改善ループ 7 回目の 3)。
 *
 * ★ 画面はログイン・起動・表に出たとき (6 時間に 1 回まで) に宛先を送り直し、updated_at が進む。
 *   送り直されない宛先は、入れ直し・別のブラウザなどで置き去りになったもの
 *   (開発者 1 人に有効 9 本、1 回の通知で 9〜12 本送っていた)。
 * ★ 外すのは印だけ (削除しない)。その端末で開き直せば送り直しで戻る (routes/push.mts の is_active = true)。
 * ★ 7 日にしなかったのは、表に出たときの送り直しを入れる前の実測で、毎日使っている 4 人の唯一の宛先が
 *   7 日より古かったため (10-10 に読んでいる人の宛先が 09-27 のまま)。
 * @returns 外した数
 */
export async function deactivateStaleSubscriptions(days: number): Promise<number> {
  if (!Number.isFinite(days) || days <= 0) return 0;   // ★ 壊れた設定で全部外さない
  const { rowCount } = await pool.query(
    `UPDATE push_subscriptions SET is_active = false, updated_at = now()
      WHERE is_active AND updated_at < now() - make_interval(days => $1)`,
    [Math.floor(days)],
  );
  return rowCount ?? 0;
}

let staleSweepTimer: NodeJS.Timeout | null = null;

/** 起動時に 1 回 + 1 日ごとに掃除する。日数は PUSH_STALE_DAYS (既定 30) */
export function startPushStaleSweep(): void {
  if (staleSweepTimer) return;
  const days = Number(process.env.PUSH_STALE_DAYS || 30);
  const run = () => {
    deactivateStaleSubscriptions(days)
      .then((n) => { if (n > 0) logger.info(`[push] ${days} 日送り直されていない宛先を ${n} 本外しました`); })
      .catch((err) => logger.warn(`[push] 古い宛先の掃除に失敗: ${err instanceof Error ? err.message : String(err)}`));
  };
  run();
  staleSweepTimer = setInterval(run, 24 * 3_600_000);
  staleSweepTimer.unref();  // ★ 停止を妨げない (#368)
}

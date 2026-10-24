import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import express from 'express';
import path from 'node:path';
import multer from 'multer';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { requireMember, requireRoomAdmin, requireGroup, requireCreator, requireSoloMember } from '../middleware/roomAccess.mts';
import { canCreateRoom, isGuest, canSearchUsers } from '../utils/permissions.mts';
import { isUuid, badIdMessage } from '../utils/uuid.mts';
import { attachMedia, attachTranscriptions, type AttachableMessage } from '../services/messageAttachments.mts';
import { announceRoomJoined, announceRoomUpdated } from '../services/roomJoined.mts';
import { rememberRoomMedia } from '../services/deletedMedia.mts';
import { signAppPass, passTarget, buildGateUrl, loadAppPassKey } from '../utils/appPass.mts';

/** #607 通行証を出せないとき。★ 理由を外に言い分けない (どの条件で落ちたかは記録にだけ残す) */
const APP_PASS_UNAVAILABLE = 'このアプリには通行証を出せません';

const ICON_DIR = path.join(process.env.MEDIA_ROOT || path.join(import.meta.dirname, '../../../media'), 'icons');
const iconStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ICON_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}-${Date.now()}${ext}`);
  },
});
const iconUpload = multer({ storage: iconStorage, limits: { fileSize: 5 * 1024 * 1024 } });

export const router = express.Router();

/** rooms テーブル行 (RETURNING * / SELECT *。アクセスする列のみ型付け) */
interface RoomRow {
  id: string;
  name: string | null;
  [key: string]: unknown;
}

/** お知らせルーム一覧の行 */
interface AnnouncementRoomRow {
  id: string;
  name: string;
}

/** お知らせメッセージ行 (m.* + sender 列。attach 系に渡すので AttachableMessage を拡張) */
interface AnnouncementMessageRow extends AttachableMessage {
  room_id: string;
  created_at: Date;
  room_name?: string;
  is_unread?: boolean;
}

// All routes require authentication
router.use(authenticate);

/**
 * ★ #594 部屋のメンバーを返すとき、ゲストには自分以外のプロフィールの「ひとこと」を見せない。
 *   利用者一覧 (GET /api/users) と同じ方針 (canSearchUsers)。#591 で 4 か所に足したときに食い違っていた
 */
function membersFor<T extends { user_id: string; status_message?: string | null }>(viewer: { id: string; role?: string }, rows: T[]): T[] {
  if (canSearchUsers(viewer)) return rows;
  return rows.map((m) => (m.user_id === viewer.id ? m : { ...m, status_message: null }));
}

/**
 * GET /api/rooms/portal-links
 * Get active portal links for home screen
 */
router.get('/portal-links', async (req, res) => {
  // #282: ポータルリンクは社内システムURL。外部ゲストには見せない (fail-closed)。
  if (isGuest(req.user)) {
    return res.json({ links: [] });
  }
  try {
    const result = await pool.query(
      'SELECT id, title, url, icon, pass FROM portal_links WHERE is_active = true ORDER BY sort_order, created_at'
    );
    res.json({ links: result.rows });
  } catch (err) {
    logger.error('Get portal links error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/announcements
 * Get messages from announcement rooms for home screen
 */
router.get('/announcements', async (req, res) => {
  const { limit = 20 } = req.query;

  // #282: お知らせはグローバル配信 (membership 無関係) のため、外部ゲストには
  // 社内お知らせが漏れる。fail-closed で guest には空を返す。将来マニュアル等を
  // 見せる場合は guest_visible フラグで出し分ける。
  if (isGuest(req.user)) {
    return res.json({ messages: [] });
  }

  try {
    // Find announcement rooms
    const roomResult = await pool.query<AnnouncementRoomRow>(
      "SELECT id, name FROM rooms WHERE is_announcement = true"
    );

    if (roomResult.rows.length === 0) {
      return res.json({ messages: [] });
    }

    const roomIds = roomResult.rows.map(r => r.id);
    const roomMap = Object.fromEntries(roomResult.rows.map(r => [r.id, r.name]));

    // Get latest messages from announcement rooms
    const msgResult = await pool.query<AnnouncementMessageRow>(
      `SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.room_id = ANY($1) AND m.is_deleted = false AND m.type != 'system' AND m.is_published = true
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [roomIds, parseInt(String(limit))]
    );

    const messages = msgResult.rows.map(m => ({
      ...m,
      room_name: roomMap[m.room_id],
    }));

    await attachMedia(messages);
    await attachTranscriptions(messages);

    // Get read status for current user
    // ★ メンバーなら一覧と同じく「既読位置と入った時刻の新しい方」から (docs/02、改善ループ 12 回目)。
    //   お知らせはメンバーでない人にも出るので、その人は既読位置だけ (無ければ全部未読) —— 今までどおり
    const cursorResult = await pool.query<{ room_id: string; last_read_at: Date | null }>(
      `SELECT r.id AS room_id,
              GREATEST(rc.last_read_at, rm.joined_at) AS last_read_at
         FROM unnest($1::uuid[]) AS r(id)
         LEFT JOIN room_read_cursors rc ON rc.room_id = r.id AND rc.user_id = $2
         LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $2`,
      [roomIds, req.user!.id]
    );
    const cursors = Object.fromEntries(cursorResult.rows.filter(r => r.last_read_at).map(r => [r.room_id, r.last_read_at]));

    messages.forEach(m => {
      const lastRead = cursors[m.room_id];
      m.is_unread = !lastRead || new Date(m.created_at) > new Date(lastRead);
    });

    res.json({ messages });
  } catch (err) {
    logger.error('Get announcements error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/rooms
 * Create a group room
 */
router.post('/', async (req, res) => {
  if (!canCreateRoom(req.user)) {
    return res.status(403).json({ error: 'ゲストユーザはルームを作成できません' });
  }
  const { name, member_ids } = req.body;
  const userId = req.user!.id;

  if (!name) {
    return res.status(400).json({ error: 'グループ名は必須です' });
  }

  // ★ 指定された人は「存在して有効な人」だけ (2026-10-02、routes/members.mts の追加口と同じ)。
  //   以前は確かめず、存在しない ID・重複で 500、無効にした人も入れられた。重複と自分自身は 1 人にまとめる
  const requested = Array.isArray(member_ids) ? member_ids : [];
  const bad = requested.find((id) => !isUuid(id));
  if (bad !== undefined) return res.status(400).json({ error: badIdMessage(String(bad)) });
  const otherIds = [...new Set(requested as string[])].filter((id) => id !== userId);
  if (otherIds.length > 0) {
    const ok = await pool.query<{ n: number }>('SELECT count(*)::int n FROM users WHERE id = ANY($1::uuid[]) AND is_active = true', [otherIds]);
    if (ok.rows[0].n !== otherIds.length) return res.status(400).json({ error: 'メンバーに指定できないユーザーが含まれています' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create room
    const roomResult = await client.query<RoomRow>(
      // ★ 新しいグループは「送った本人なら編集できる」(sender) で作る (2026-10-24 小野さん判断、docs/02)。
      //   DB の列の既定は none のまま (1 対 1 と、それより前の部屋は変えない)
      `INSERT INTO rooms (type, name, created_by, message_edit_policy)
       VALUES ('group', $1, $2, 'sender')
       RETURNING *`,
      [name, userId]
    );
    const room = roomResult.rows[0];

    // Add creator as admin
    await client.query(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [room.id, userId]
    );

    // Add other members (★ 上で確かめて重複と自分を除いた分)
    for (const memberId of otherIds) {
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role)
         VALUES ($1, $2, 'member')`,
        [room.id, memberId]
      );
    }

    // デフォルト TODO タグ作成
    await client.query(
      `INSERT INTO tags (room_id, name, is_todo, created_by) VALUES ($1, 'TODO', true, $2)`,
      [room.id, userId]
    );

    await client.query('COMMIT');

    // Fetch members
    const membersResult = await pool.query(
      `SELECT rm.user_id, rm.role, rm.joined_at, u.display_name, u.avatar_url, u.status_message, u.is_active
       FROM room_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1`,
      [room.id]
    );

    // ★ #486 入った全員の接続を部屋に入れ、本人に知らせる (読み込み直すまで出なかった)
    announceRoomJoined(room.id, membersResult.rows.map((m: { user_id: string }) => m.user_id));
    res.status(201).json({ room, members: membersFor(req.user!, membersResult.rows) });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Create room error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});

/**
 * POST /api/rooms/direct
 * Create or get a direct (1-on-1) room
 */
router.post('/direct', async (req, res) => {
  if (!canCreateRoom(req.user)) {
    return res.status(403).json({ error: 'ゲストユーザはルームを作成できません' });
  }
  const { partner_id } = req.body;
  const userId = req.user!.id;

  if (!partner_id) {
    return res.status(400).json({ error: '相手のユーザーIDは必須です' });
  }
  // ★ 相手は「自分以外の、存在して有効な人」だけ (2026-10-02、routes/members.mts と同じ確かめ)。
  //   以前は存在しない ID で 500、無効にした人とも作れ、自分自身を指定すると手持ちの 1 対 1 のどれかが返った
  if (!isUuid(partner_id)) return res.status(400).json({ error: badIdMessage(String(partner_id)) });
  if (partner_id === userId) return res.status(400).json({ error: '自分自身とは 1 対 1 を作れません' });

  try {
    const partner = await pool.query('SELECT 1 FROM users WHERE id = $1 AND is_active = true', [partner_id]);
    if (partner.rows.length === 0) return res.status(404).json({ error: 'ユーザーが見つかりません' });

    // Check if direct room already exists between these two users
    const existingResult = await pool.query<RoomRow>(
      `SELECT r.* FROM rooms r
       WHERE r.type = 'direct'
         AND r.id IN (
           SELECT room_id FROM room_members WHERE user_id = $1
         )
         AND r.id IN (
           SELECT room_id FROM room_members WHERE user_id = $2
         )`,
      [userId, partner_id]
    );

    if (existingResult.rows.length > 0) {
      const room = existingResult.rows[0];
      const membersResult = await pool.query(
        `SELECT rm.user_id, rm.role, rm.joined_at, u.display_name, u.avatar_url, u.status_message, u.is_active
         FROM room_members rm
         JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id = $1`,
        [room.id]
      );
      return res.status(200).json({ room, members: membersFor(req.user!, membersResult.rows) });
    }

    // Create new direct room
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const roomResult = await client.query<RoomRow>(
        // ★ 1 対 1 も「送った本人なら編集できる」(sender) で作る (2026-10-24 小野さん判断、docs/02)
        `INSERT INTO rooms (type, created_by, message_edit_policy)
         VALUES ('direct', $1, 'sender')
         RETURNING *`,
        [userId]
      );
      const room = roomResult.rows[0];

      await client.query(
        `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
        [room.id, userId, partner_id]
      );

      // デフォルト TODO タグ作成
      await client.query(
        `INSERT INTO tags (room_id, name, is_todo, created_by) VALUES ($1, 'TODO', true, $2)`,
        [room.id, userId]
      );

      await client.query('COMMIT');

      const membersResult = await pool.query(
        `SELECT rm.user_id, rm.role, rm.joined_at, u.display_name, u.avatar_url, u.status_message, u.is_active
         FROM room_members rm
         JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id = $1`,
        [room.id]
      );

      // ★ #486 1 対 1 の相手にも、読み込み直さずに出るようにする
      announceRoomJoined(room.id, membersResult.rows.map((m: { user_id: string }) => m.user_id));
      res.status(201).json({ room, members: membersFor(req.user!, membersResult.rows) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Create direct room error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms
 * List rooms the current user belongs to
 */
router.get('/', async (req, res) => {
  const userId = req.user!.id;

  try {
    const result = await pool.query(
      `SELECT r.*,
              rm.push_muted,
              m.content AS last_message_content,
              m.created_at AS last_message_at,
              m.type AS last_message_type,
              u.display_name AS last_message_sender,
              partner.user_id AS partner_id,
              partner.display_name AS partner_display_name,
              partner.avatar_url AS partner_avatar_url,
              COALESCE(unread.count, 0)::int AS unread_count,
              -- ★ 利用停止の人は数えない (一覧には「利用停止」と添えて残す、改善ループ 10-13 の 4.)
              (SELECT COUNT(*)::int FROM room_members rmc JOIN users uc ON uc.id = rmc.user_id
                WHERE rmc.room_id = r.id AND uc.is_active = true) AS member_count
       FROM rooms r
       JOIN room_members rm ON rm.room_id = r.id
       LEFT JOIN LATERAL (
         SELECT content, created_at, type, sender_id
         FROM messages
         WHERE room_id = r.id AND is_deleted = false
         ORDER BY created_at DESC
         LIMIT 1
       ) m ON true
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN LATERAL (
         SELECT rm2.user_id, u2.display_name, u2.avatar_url
         FROM room_members rm2
         JOIN users u2 ON u2.id = rm2.user_id
         WHERE rm2.room_id = r.id AND rm2.user_id != $1
         LIMIT 1
       ) partner ON r.type = 'direct'
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS count
         FROM messages msg
         WHERE msg.room_id = r.id
           AND msg.is_deleted = false
           AND msg.sender_id != $1
           -- ★ 既読位置と入った時刻の新しい方から (入る前の便も、抜けていた間の便も未読にしない、docs/02)。
           --   GREATEST は NULL を飛ばすので、既読位置が無ければ入った時刻になる
           AND msg.created_at > GREATEST(
             (SELECT last_read_at FROM room_read_cursors WHERE room_id = r.id AND user_id = $1),
             rm.joined_at
           )
       ) unread ON true
       WHERE rm.user_id = $1
       ORDER BY COALESCE(m.created_at, r.created_at) DESC`,
      [userId]
    );

    res.json({ rooms: result.rows });
  } catch (err) {
    logger.error('List rooms error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id
 * Get room details with members
 */
router.get('/:id', requireMember, async (req, res) => {
  const { id } = req.params;

  try {
    // Get room
    const roomResult = await pool.query<RoomRow>('SELECT * FROM rooms WHERE id = $1', [id]);
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'ルームが見つかりません' });
    }

    // Get members
    const membersResult = await pool.query(
      `SELECT rm.user_id, rm.role, rm.joined_at, u.display_name, u.avatar_url, u.status_message, u.is_active
       FROM room_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1`,
      [id]
    );

    // Get last read message ID for unread separator
    // ★ 既読位置が入った時刻より古い (抜けて戻った) なら線を出さない。一覧の未読と同じ考え方 (docs/02、改善ループ 13 回目)
    const cursorResult = await pool.query<{ last_read_message_id: string | null }>(
      `SELECT rc.last_read_message_id
         FROM room_read_cursors rc
         LEFT JOIN room_members rm ON rm.room_id = rc.room_id AND rm.user_id = rc.user_id
        WHERE rc.room_id = $1 AND rc.user_id = $2
          AND (rm.joined_at IS NULL OR rc.last_read_at >= rm.joined_at)`,
      [id, req.user!.id]
    );
    const last_read_message_id = cursorResult.rows[0]?.last_read_message_id || null;

    // #463 自分がこのルームの通知を鳴らさないにしているか (各自の設定なので room に自分の分だけ載せる)
    const muteResult = await pool.query<{ push_muted: boolean }>(
      'SELECT push_muted FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, req.user!.id]
    );
    const push_muted = muteResult.rows[0]?.push_muted ?? false;

    res.json({ room: { ...roomResult.rows[0], push_muted }, members: membersFor(req.user!, membersResult.rows), last_read_message_id });
  } catch (err) {
    logger.error('Get room error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * #607 部屋のアプリとホームのタブで共通の後半: URL の形 → 鍵 → 署名。
 * 出せないときは refuse を呼んで null を返す (refuse が応答を返す)
 */
function issueAppPass(
  url: string, room: string, user: { id: string; display_name: string }, refuse: (why: string) => unknown,
): string | null {
  const target = passTarget(url);
  // ★ passTarget は http: のほか、パスが // や /\ で始まる https も断る (よそへ飛ばされないため)
  if (!target) { refuse('https の URL でない、または行き先の形が崩れている'); return null; }
  const key = loadAppPassKey(target.host);
  if (!key) { refuse(`鍵が無い (${target.host})`); return null; }
  const token = signAppPass(key, {
    aud: target.origin, room, sub: user.id, name: user.display_name, to: target.to,
  }, Math.floor(Date.now() / 1000));
  return buildGateUrl(target, token);
}

/**
 * POST /api/rooms/portal-links/:id/app-pass
 * #607 ホーム画面のタブ (portal_links) の通行証 (docs/11 §5.4)。通す範囲は「タブが見えている人」=
 * ゲストを除くログイン中の人 (GET /portal-links と同じ #282)。機械は除く。通行証の room は "home"
 */
router.post('/portal-links/:id/app-pass', async (req, res) => {
  const linkId = String(req.params.id);
  if (!isUuid(linkId)) return res.status(400).json({ error: badIdMessage(linkId) });
  const refuse = (why: string) => {
    logger.info(`[app-pass] 出さない: portal=${linkId} user=${req.user!.id} — ${why}`);
    return res.status(404).json({ error: APP_PASS_UNAVAILABLE });
  };
  if (isGuest(req.user)) return refuse('ゲスト');
  if (req.user!.is_bot) return refuse('機械のアカウント');
  try {
    const r = await pool.query<{ url: string; pass: boolean }>(
      'SELECT url, pass FROM portal_links WHERE id = $1 AND is_active = true', [linkId],
    );
    const link = r.rows[0];
    if (!link) return refuse('そのリンクが無い (または止めてある)');
    if (link.pass !== true) return refuse('通行証を添えるが付いていない');
    const gateUrl = issueAppPass(link.url, 'home', req.user!, refuse);
    if (gateUrl) res.json({ url: gateUrl });
  } catch (err) {
    logger.error('Portal app pass error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/rooms/:id/app-pass  (body: { index, url })
 * #607 アプリパネルのアプリを開くための、2 分だけ有効な通行証つきの入口 URL を返す (docs/11 §5.2)。
 * ★ 出すのは「その部屋のメンバー」で「通行証を添える」が付いたアプリ、鍵のあるサイトのときだけ。
 *   出せない理由は外に言い分けない (どれも 404 と同じ文)。記録には残す
 */
router.post('/:id/app-pass', requireMember, async (req, res) => {
  const roomId = String(req.params.id);
  const { index, url } = req.body ?? {};
  if (!Number.isInteger(index) || index < 0 || typeof url !== 'string') {
    return res.status(400).json({ error: 'index (整数) と url を指定してください' });
  }
  const refuse = (why: string) => {
    logger.info(`[app-pass] 出さない: room=${roomId} user=${req.user!.id} index=${index} — ${why}`);
    return res.status(404).json({ error: APP_PASS_UNAVAILABLE });
  };
  // ★ 改善ループ 9 回目の G: ホームの口はゲストを断っていたのに、部屋の口は断っていなかった (docs/11 §1 の「通さない人」)
  if (isGuest(req.user)) return refuse('ゲスト');
  // ★ 機械のアカウントは多くの部屋のメンバーなので、メンバーであることを人の印にしない
  if (req.user!.is_bot) return refuse('機械のアカウント');
  try {
    const r = await pool.query<{ app_urls: Array<{ url?: unknown; pass?: unknown }> | null }>(
      'SELECT app_urls FROM rooms WHERE id = $1', [roomId],
    );
    const entry = r.rows[0]?.app_urls?.[index];
    if (!entry) return refuse('その番号のアプリが無い');
    // ★ url も照らす: 開いている間に管理者が並べ替えたとき、別のアプリの通行証を出さない
    if (entry.url !== url) return refuse('url が今の並びと合わない');
    if (entry.pass !== true) return refuse('通行証を添えるが付いていない');
    const gateUrl = issueAppPass(url, roomId, req.user!, refuse);
    if (gateUrl) res.json({ url: gateUrl });
  } catch (err) {
    logger.error('App pass error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/rooms/:id/notification
 * #463 自分の分だけ、このルームの通知を鳴らす / 鳴らさないを切り替える (body: { muted: boolean })
 * ★ 通話の着信は止めない (docs/02 room_members.push_muted)
 */
router.put('/:id/notification', requireMember, async (req, res) => {
  const { muted } = (req.body ?? {}) as { muted?: unknown };
  if (typeof muted !== 'boolean') {
    return res.status(400).json({ error: 'muted は true / false で指定してください' });
  }
  try {
    const r = await pool.query<{ push_muted: boolean }>(
      'UPDATE room_members SET push_muted = $1 WHERE room_id = $2 AND user_id = $3 RETURNING push_muted',
      [muted, req.params.id, req.user!.id]
    );
    res.json({ push_muted: r.rows[0].push_muted });
  } catch (err) {
    logger.error('Update room notification error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/rooms/:id
 * Update group name (group admin only)
 */
router.put('/:id', requireGroup, requireMember, requireRoomAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, allow_member_transcription_edit, is_announcement, app_urls, message_edit_policy, voice_conversation_enabled, voice_conversation_tools, voice_conversation_denied_tools, push_machine_posts } = req.body;

  // ★ #540 お知らせの切り替えはシステム管理者だけ (画面もシステム管理者にだけ出している)。
  //   以前は部屋の管理者でも通り、画面と本体で決まりが食い違っていた
  if (is_announcement !== undefined && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'お知らせの切り替えはシステム管理者だけができます' });
  }

  try {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (name !== undefined) { updates.push(`name = $${paramIndex++}`); values.push(name); }
    if (allow_member_transcription_edit !== undefined) { updates.push(`allow_member_transcription_edit = $${paramIndex++}`); values.push(allow_member_transcription_edit); }
    if (is_announcement !== undefined) { updates.push(`is_announcement = $${paramIndex++}`); values.push(is_announcement); }
    if (app_urls !== undefined) { updates.push(`app_urls = $${paramIndex++}`); values.push(JSON.stringify(app_urls)); }
    if (message_edit_policy !== undefined) { updates.push(`message_edit_policy = $${paramIndex++}`); values.push(message_edit_policy); }
    // #405 Realtime 音声会話 (docs/08 §12)。既定 false = 開けたルームにだけ入口が出る
    if (voice_conversation_enabled !== undefined) { updates.push(`voice_conversation_enabled = $${paramIndex++}`); values.push(voice_conversation_enabled); }
    // #405 会話モードで上乗せする道具の名前。★ requireRoomAdmin で守られているのがここに置く理由
    // ★ #418 で意味を「既定で外れている道具を戻す」に読み替えた (docs/08 §12.17)。列名はそのまま
    if (voice_conversation_tools !== undefined) { updates.push(`voice_conversation_tools = $${paramIndex++}`); values.push(JSON.stringify(voice_conversation_tools)); }
    // #418 会話モードで外す道具。★ 既定は空 = 何もしなければ 1 つも外れない
    if (voice_conversation_denied_tools !== undefined) { updates.push(`voice_conversation_denied_tools = $${paramIndex++}`); values.push(JSON.stringify(voice_conversation_denied_tools)); }
    // #463 機械 (is_bot) の投稿でも通知を鳴らすか。既定 false。★ 管理者だけが変えられる (requireRoomAdmin)
    if (push_machine_posts !== undefined) {
      if (typeof push_machine_posts !== 'boolean') return res.status(400).json({ error: 'push_machine_posts は true / false で指定してください' });
      updates.push(`push_machine_posts = $${paramIndex++}`); values.push(push_machine_posts);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '更新する項目がありません' });
    }

    updates.push('updated_at = now()');
    values.push(id);

    const result = await pool.query(
      `UPDATE rooms SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    announceRoomUpdated(result.rows[0].id);   // ★ #489 開いている人の画面に反映する
    res.json({ room: result.rows[0] });
  } catch (err) {
    logger.error('Update room error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/rooms/:id
 * Delete a group room (creator only, must be the only remaining member)
 *
 * Safety constraints:
 * - Group only (direct rooms use leave instead)
 * - Caller must be the room creator (rooms.created_by)
 * - No other members may exist (caller must remove all members first)
 *
 * CASCADE will cleanup: room_members, messages, message_media,
 * voice_transcriptions, message_reads, room_read_cursors, tags etc.
 * ★ 別の部屋へ転送した写しは残る (forwarded_from に参照の縛りが無い、migration 038)。
 *   縛りがあった頃は、写しが 1 つでもあると削除全体が 500 で失敗していた
 */
router.delete('/:id', requireGroup, requireMember, requireCreator, requireSoloMember, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ★ #602 消すと添付の行も CASCADE で消え、/media の判定 (#601) に引っかからなくなる。消す前に記録する
    await rememberRoomMedia(String(id), client);
    const result = await client.query<{ id: string; name: string | null }>('DELETE FROM rooms WHERE id = $1 RETURNING id, name', [id]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: E.ROOM_NOT_FOUND });
    }
    await client.query('COMMIT');
    logger.info(`Room deleted: ${id} (${result.rows[0].name}) by user ${req.user!.id}`);
    res.json({ success: true, room_id: id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Delete room error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});

/**
 * POST /api/rooms/:id/icon
 * Upload group icon (group admin only)
 */
router.post('/:id/icon', requireGroup, requireMember, requireRoomAdmin, iconUpload.single('icon'), async (req, res) => {
  const { id } = req.params;

  try {
    if (!req.file) return res.status(400).json({ error: '画像ファイルが添付されていません' });

    const iconUrl = `icons/${req.file.filename}`;
    const result = await pool.query(
      'UPDATE rooms SET icon_url = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [iconUrl, id]
    );
    announceRoomUpdated(result.rows[0].id);   // ★ #489 開いている人の画面に反映する
    res.json({ room: result.rows[0] });
  } catch (err) {
    logger.error('Upload room icon error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
